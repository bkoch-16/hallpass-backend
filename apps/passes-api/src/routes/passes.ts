import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  createPassBody,
  approvePassBody,
  denyPassBody,
  cancelPassBody,
  passIdParams,
  listPassesQuery,
} from "../schemas/passes";
import { claimSlot, releaseSlot, promoteFromQueue } from "../lib/slots.js";
import { emitPassEvent } from "../lib/socket.js";
import { schedulePassExpiry } from "../lib/queue.js";

const router = Router({ mergeParams: true });

// Helper: get today's date string "YYYY-MM-DD" in a given timezone
function getTodayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    // fallback to UTC
    return new Date().toISOString().slice(0, 10);
  }
}

// Helper: get current "HH:MM" time string in a given timezone
function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return formatter.format(new Date());
  } catch {
    const now = new Date();
    const h = String(now.getUTCHours()).padStart(2, "0");
    const m = String(now.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

// Helper: add minutes to "HH:MM" string, returns "HH:MM"
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const clampedH = Math.floor(total / 60) % 24;
  const clampedM = total % 60;
  return `${String(clampedH).padStart(2, "0")}:${String(clampedM).padStart(2, "0")}`;
}

// Helper: check if timeA <= timeB (both "HH:MM")
function timeLeq(a: string, b: string): boolean {
  return a <= b;
}

// Helper: interval start date based on PolicyInterval
function getIntervalStart(interval: string): Date {
  const now = new Date();
  if (interval === "DAY") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (interval === "WEEK") {
    const d = new Date(now);
    const day = d.getUTCDay(); // 0=Sunday
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  // MONTH
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// POST /passes — any authenticated user (student) can create a pass
router.post(
  "/",
  requireAuth,
  validateBody(createPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const schoolId = user.schoolId;

    if (!schoolId) {
      res.status(422).json({ error: "No active period" });
      return;
    }

    // 1. Resolve school timezone
    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { timezone: true },
    });
    const timezone = school?.timezone ?? "UTC";

    // 2. Get today's date in school timezone
    const today = getTodayInTimezone(timezone);
    const todayDate = new Date(today + "T00:00:00Z");

    // 3. Query SchoolCalendar for today
    const calendar = await prisma.schoolCalendar.findFirst({
      where: { schoolId, date: todayDate },
    });

    if (!calendar || calendar.scheduleTypeId === null) {
      res.status(422).json({ error: "No active period" });
      return;
    }

    // 4. Get current time in school timezone
    const currentTime = getCurrentTimeInTimezone(timezone);

    // 5. Find a Period matching the schedule type and current time window
    // Fetch periods for this schedule type
    const periods = await prisma.period.findMany({
      where: {
        scheduleTypeId: calendar.scheduleTypeId,
        schoolId,
        deletedAt: null,
      },
      include: { scheduleType: true },
    });

    const activePeriod = periods.find((p) => {
      const windowStart = addMinutesToTime(p.startTime, -(p.scheduleType?.startBuffer ?? 0));
      const windowEnd = addMinutesToTime(p.endTime, p.scheduleType?.endBuffer ?? 0);
      return timeLeq(windowStart, currentTime) && timeLeq(currentTime, windowEnd);
    });

    if (!activePeriod) {
      res.status(422).json({ error: "No active period" });
      return;
    }

    // 6. Check PassPolicy
    const policy = await prisma.passPolicy.findFirst({ where: { schoolId } });

    if (policy && policy.interval && policy.maxPerInterval !== null) {
      const intervalStart = getIntervalStart(policy.interval);
      const passCount = await prisma.pass.count({
        where: {
          studentId: user.id,
          schoolId,
          requestedAt: { gte: intervalStart },
        },
      });
      if (passCount >= policy.maxPerInterval) {
        res.status(422).json({ error: "Pass limit reached" });
        return;
      }
    }

    // 7. Create pass (stub: always PENDING, slot check always succeeds)
    try {
      const pass = await prisma.pass.create({
        data: {
          schoolId,
          studentId: user.id,
          destinationId: req.body.destinationId,
          periodId: activePeriod.id,
          note: req.body.note,
          status: "PENDING",
        },
      });
      if (pass.status === "PENDING") {
        emitPassEvent(pass, "pass:created");
      } else if (pass.status === "WAITING") {
        emitPassEvent(pass, "pass:queued");
      }

      if (pass.periodId && activePeriod) {
        const [hours, minutes] = activePeriod.endTime.split(":").map(Number);
        const endTime = new Date();
        endTime.setHours(hours, minutes + (activePeriod.scheduleType?.endBuffer ?? 0), 0, 0);
        await schedulePassExpiry(pass.id, endTime);
      }

      res.status(201).json(pass);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
        res.status(409).json({ error: "Active pass already exists" });
        return;
      }
      throw err;
    }
  },
);

// GET /passes — list passes (scoped by role)
router.get(
  "/",
  requireAuth,
  validateQuery(listPassesQuery),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { status } = req.query as { status?: string };

    const isStudent = user.role === UserRole.STUDENT;
    const where: Record<string, unknown> = {
      schoolId: user.schoolId,
      ...(status ? { status } : {}),
      ...(isStudent ? { studentId: user.id } : {}),
    };

    const passes = await prisma.pass.findMany({ where });
    res.json(passes);
  },
);

// GET /passes/:id — fetch single pass
router.get(
  "/:id",
  requireAuth,
  validateParams(passIdParams),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const isStudent = user.role === UserRole.STUDENT;

    const pass = await prisma.pass.findFirst({
      where: {
        id,
        schoolId: user.schoolId ?? undefined,
        ...(isStudent ? { studentId: user.id } : {}),
      },
    });

    if (!pass) {
      res.status(404).json({ error: "Pass not found" });
      return;
    }

    res.json(pass);
  },
);

// POST /passes/:id/approve — TEACHER or ADMIN only
router.post(
  "/:id/approve",
  requireAuth,
  requireRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(passIdParams),
  validateBody(approvePassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const pass = await prisma.pass.findFirst({
      where: { id, schoolId: user.schoolId ?? undefined },
    });

    if (!pass) {
      res.status(404).json({ error: "Pass not found" });
      return;
    }

    if (pass.status !== "PENDING") {
      res.status(400).json({ error: "Pass is not in PENDING status" });
      return;
    }

    const destination = await prisma.destination.findUnique({ where: { id: pass.destinationId } });
    const slotClaimed = await claimSlot(pass.destinationId, destination?.maxOccupancy ?? null);
    const newStatus = slotClaimed ? "ACTIVE" : "WAITING";

    const updated = await prisma.pass.update({
      where: { id },
      data: {
        status: newStatus,
        approverId: user.id,
        approvedAt: new Date(),
        ...(req.body.approverNote !== undefined ? { approverNote: req.body.approverNote } : {}),
      },
    });

    if (updated.status === "ACTIVE") {
      emitPassEvent(updated, "pass:approved");
    } else if (updated.status === "WAITING") {
      emitPassEvent(updated, "pass:queued");
    }

    res.json(updated);
  },
);

// POST /passes/:id/deny — TEACHER or ADMIN only
router.post(
  "/:id/deny",
  requireAuth,
  requireRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(passIdParams),
  validateBody(denyPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const pass = await prisma.pass.findFirst({
      where: { id, schoolId: user.schoolId ?? undefined },
    });

    if (!pass) {
      res.status(404).json({ error: "Pass not found" });
      return;
    }

    if (pass.status !== "PENDING") {
      res.status(400).json({ error: "Pass must be PENDING to deny" });
      return;
    }

    const updated = await prisma.pass.update({
      where: { id },
      data: {
        status: "DENIED",
        denierId: user.id,
        deniedAt: new Date(),
        ...(req.body.approverNote !== undefined ? { approverNote: req.body.approverNote } : {}),
      },
    });

    emitPassEvent(updated, "pass:denied");

    res.json(updated);
  },
);

// POST /passes/:id/return — student owner OR TEACHER/ADMIN
router.post(
  "/:id/return",
  requireAuth,
  validateParams(passIdParams),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const isStudent = user.role === UserRole.STUDENT;

    // Students can only return their own passes; teachers/admins can return any pass in school
    const pass = await prisma.pass.findFirst({
      where: {
        id,
        schoolId: user.schoolId ?? undefined,
        ...(isStudent ? { studentId: user.id } : {}),
      },
    });

    if (!pass) {
      res.status(404).json({ error: "Pass not found" });
      return;
    }

    if (pass.status !== "ACTIVE") {
      res.status(400).json({ error: "Pass must be ACTIVE to return" });
      return;
    }

    const destination = await prisma.destination.findUnique({ where: { id: pass.destinationId } });

    const updated = await prisma.pass.update({
      where: { id },
      data: {
        status: "COMPLETED",
        returnedAt: new Date(),
      },
    });

    emitPassEvent(updated, "pass:returned");

    await releaseSlot(pass.destinationId, destination?.maxOccupancy ?? null);
    await promoteFromQueue(pass.destinationId, destination?.maxOccupancy ?? null);

    res.json(updated);
  },
);

// POST /passes/:id/cancel — student owner, teacher, or admin
router.post(
  "/:id/cancel",
  requireAuth,
  requireRole(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(passIdParams),
  validateBody(cancelPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const isTeacherOrAbove = user.role === UserRole.TEACHER || user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;

    // Students can only cancel their own passes; teachers/admins can cancel any pass in their school
    const where = isTeacherOrAbove
      ? { id, schoolId: user.schoolId ?? undefined }
      : { id, studentId: user.id, schoolId: user.schoolId ?? undefined };

    const pass = await prisma.pass.findFirst({ where });

    if (!pass) {
      res.status(404).json({ error: "Pass not found" });
      return;
    }

    if (pass.status !== "PENDING" && pass.status !== "WAITING" && pass.status !== "ACTIVE") {
      res.status(400).json({ error: "Pass must be PENDING, WAITING, or ACTIVE to cancel" });
      return;
    }

    const updated = await prisma.pass.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancellerId: user.id,
        cancelledAt: new Date(),
      },
    });

    emitPassEvent(updated, "pass:cancelled");

    if (pass.status === "ACTIVE") {
      const destination = await prisma.destination.findUnique({ where: { id: pass.destinationId } });
      await releaseSlot(pass.destinationId, destination?.maxOccupancy ?? null);
      await promoteFromQueue(pass.destinationId, destination?.maxOccupancy ?? null);
    }

    res.json(updated);
  },
);

export default router;
