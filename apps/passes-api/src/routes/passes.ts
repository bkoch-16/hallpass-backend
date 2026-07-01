import { Router, Request, Response } from "express";
import { prisma, PassStatus } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import { logger } from "@hallpass/logger";
import { requireAuth } from "../middleware/auth.js";
import { requireSchool } from "../middleware/requireSchool.js";
import { requireMinRole, roleRank } from "../middleware/roleGuard.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate.js";
import {
  createPassBody,
  approvePassBody,
  denyPassBody,
  passIdParams,
  listPassesQuery,
} from "../schemas/passes.js";
import { claimSlot, releaseSlot, releaseAndPromote } from "../lib/slots.js";
import { emitPassEvent } from "../lib/socket.js";
import { schedulePassExpiry } from "../lib/queue.js";
import {
  periodEndDate,
  getTodayInTimezone,
  getCurrentTimeInTimezone,
  getIntervalStart,
  addMinutesToTime,
} from "../lib/time.js";

const router = Router({ mergeParams: true });

// Works because "HH:MM" strings are zero-padded and equal-length.
function timeLeq(a: string, b: string): boolean {
  return a <= b;
}

// POST /passes — any authenticated user (student) can create a pass
router.post(
  "/",
  requireAuth,
  requireSchool,
  validateBody(createPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const schoolId = user.schoolId!;

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
      res.status(422).json({ message: "No active period" });
      return;
    }

    // 4. Get current time in school timezone
    const currentTime = getCurrentTimeInTimezone(timezone);

    // 5. Find a Period matching the schedule type and current time window
    const periods = await prisma.period.findMany({
      where: {
        scheduleTypeId: calendar.scheduleTypeId,
        schoolId,
        deletedAt: null,
      },
      include: { scheduleType: true },
    });

    const activePeriod = periods.find((p) => {
      const windowStart = addMinutesToTime(
        p.startTime,
        -(p.scheduleType?.startBuffer ?? 0),
      );
      const windowEnd = addMinutesToTime(
        p.endTime,
        p.scheduleType?.endBuffer ?? 0,
      );
      return (
        timeLeq(windowStart, currentTime) && timeLeq(currentTime, windowEnd)
      );
    });

    if (!activePeriod) {
      res.status(422).json({ message: "No active period" });
      return;
    }

    // 6. Check PassPolicy — only count in-flight/completed passes; denied/expired/cancelled don't burn quota
    const policy = await prisma.passPolicy.findFirst({ where: { schoolId } });

    if (policy && policy.interval && policy.maxPerInterval !== null) {
      const intervalStart = getIntervalStart(policy.interval, timezone);
      const passCount = await prisma.pass.count({
        where: {
          studentId: user.id,
          schoolId,
          requestedAt: { gte: intervalStart },
          status: {
            in: [
              PassStatus.PENDING,
              PassStatus.WAITING,
              PassStatus.ACTIVE,
              PassStatus.COMPLETED,
            ],
          },
        },
      });
      if (passCount >= policy.maxPerInterval) {
        res.status(422).json({ message: "Pass limit reached" });
        return;
      }
    }

    // 7. Validate destination belongs to this school
    const destination = await prisma.destination.findFirst({
      where: { id: req.body.destinationId, schoolId, deletedAt: null },
    });
    if (!destination) {
      res.status(422).json({ message: "Destination not found" });
      return;
    }

    // 8. Create pass (always PENDING; slot is claimed at approve step)
    let pass;
    try {
      pass = await prisma.pass.create({
        data: {
          schoolId,
          studentId: user.id,
          destinationId: destination.id,
          periodId: activePeriod.id,
          note: req.body.note,
          status: PassStatus.PENDING,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        res.status(409).json({ message: "Active pass already exists" });
        return;
      }
      throw err;
    }
    emitPassEvent(pass, "pass:created");

    void Promise.resolve(
      schedulePassExpiry(
        pass.id,
        periodEndDate(
          activePeriod.endTime,
          activePeriod.scheduleType?.endBuffer ?? 0,
          timezone,
        ),
      ),
    ).catch((err) => logger.warn(err, "Failed to schedule pass expiry — will be recovered by reconcile"));

    res.status(201).json(pass);
  },
);

// GET /passes — list passes (scoped by role)
router.get(
  "/",
  requireAuth,
  requireSchool,
  validateQuery(listPassesQuery),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { status } = req.query as { status?: string };
    const isStudent = user.role === UserRole.STUDENT;
    const where: Record<string, unknown> = {
      schoolId: user.schoolId!,
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
  requireSchool,
  validateParams(passIdParams),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const isStudent = user.role === UserRole.STUDENT;

    const pass = await prisma.pass.findFirst({
      where: {
        id,
        schoolId: user.schoolId!,
        ...(isStudent ? { studentId: user.id } : {}),
      },
    });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    res.json(pass);
  },
);

// POST /passes/:id/approve — TEACHER or ADMIN only
router.post(
  "/:id/approve",
  requireAuth,
  requireSchool,
  requireMinRole(UserRole.TEACHER),
  validateParams(passIdParams),
  validateBody(approvePassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const pass = await prisma.pass.findFirst({
      where: { id, schoolId: user.schoolId! },
      include: { destination: { select: { maxOccupancy: true } } },
    });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    if (pass.status !== PassStatus.PENDING) {
      res.status(400).json({ message: "Pass is not in PENDING status" });
      return;
    }

    const maxOccupancy = pass.destination.maxOccupancy;
    const slotClaimed = await claimSlot(pass.destinationId, maxOccupancy);
    const newStatus = slotClaimed ? PassStatus.ACTIVE : PassStatus.WAITING;

    let count;
    try {
      ({ count } = await prisma.pass.updateMany({
        where: { id, status: PassStatus.PENDING },
        data: {
          status: newStatus,
          approverId: user.id,
          approvedAt: new Date(),
          ...(slotClaimed ? { activatedAt: new Date() } : {}),
          ...(req.body.approverNote !== undefined
            ? { approverNote: req.body.approverNote }
            : {}),
        },
      }));
    } catch (err) {
      if (slotClaimed) {
        try {
          await releaseSlot(pass.destinationId, maxOccupancy);
        } catch (releaseErr) {
          logger.error(releaseErr, "Failed to release slot after approve DB error");
        }
      }
      throw err;
    }

    if (count === 0) {
      // Another request transitioned this pass first — give back the slot we claimed
      if (slotClaimed) {
        try {
          await releaseSlot(pass.destinationId, maxOccupancy);
        } catch (releaseErr) {
          logger.error(releaseErr, "Failed to release slot after lost approve race");
        }
      }
      res.status(409).json({ message: "Pass is no longer PENDING" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id } });

    if (updated.status === PassStatus.ACTIVE) {
      emitPassEvent(updated, "pass:approved");
    } else if (updated.status === PassStatus.WAITING) {
      emitPassEvent(updated, "pass:queued");
    }

    res.json(updated);
  },
);

// POST /passes/:id/deny — TEACHER or ADMIN only
router.post(
  "/:id/deny",
  requireAuth,
  requireSchool,
  requireMinRole(UserRole.TEACHER),
  validateParams(passIdParams),
  validateBody(denyPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const pass = await prisma.pass.findFirst({
      where: { id, schoolId: user.schoolId! },
    });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    // WAITING passes are cancelled, not denied — deny is PENDING-only by design
    if (pass.status !== PassStatus.PENDING) {
      res.status(400).json({ message: "Pass must be PENDING to deny" });
      return;
    }

    const { count } = await prisma.pass.updateMany({
      where: { id, status: PassStatus.PENDING },
      data: {
        status: PassStatus.DENIED,
        denierId: user.id,
        deniedAt: new Date(),
        ...(req.body.approverNote !== undefined
          ? { approverNote: req.body.approverNote }
          : {}),
      },
    });

    if (count === 0) {
      res.status(409).json({ message: "Pass is no longer PENDING" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id } });

    emitPassEvent(updated, "pass:denied");

    res.json(updated);
  },
);

// POST /passes/:id/return — student owner OR TEACHER/ADMIN
router.post(
  "/:id/return",
  requireAuth,
  requireSchool,
  validateParams(passIdParams),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const isStudent = user.role === UserRole.STUDENT;

    // Students can only return their own passes; teachers/admins can return any pass in school
    const pass = await prisma.pass.findFirst({
      where: {
        id,
        schoolId: user.schoolId!,
        ...(isStudent ? { studentId: user.id } : {}),
      },
      include: { destination: { select: { maxOccupancy: true } } },
    });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    if (pass.status !== PassStatus.ACTIVE) {
      res.status(400).json({ message: "Pass must be ACTIVE to return" });
      return;
    }

    const { count } = await prisma.pass.updateMany({
      where: { id, status: PassStatus.ACTIVE },
      data: {
        status: PassStatus.COMPLETED,
        returnedAt: new Date(),
      },
    });

    if (count === 0) {
      res.status(409).json({ message: "Pass is no longer ACTIVE" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id } });

    emitPassEvent(updated, "pass:returned");

    await releaseAndPromote(pass.destinationId, pass.destination.maxOccupancy);

    res.json(updated);
  },
);

// POST /passes/:id/cancel — student owner, teacher, or admin
router.post(
  "/:id/cancel",
  requireAuth,
  requireSchool,
  validateParams(passIdParams),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const isTeacherOrAbove = roleRank(user.role) >= roleRank(UserRole.TEACHER);

    // Students can only cancel their own passes; teachers/admins can cancel any pass in their school
    const where = isTeacherOrAbove
      ? { id, schoolId: user.schoolId! }
      : { id, studentId: user.id, schoolId: user.schoolId! };

    const pass = await prisma.pass.findFirst({ where });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    const cancellable: PassStatus[] = [PassStatus.PENDING, PassStatus.WAITING];
    if (!cancellable.includes(pass.status)) {
      res
        .status(400)
        .json({ message: "Pass must be PENDING or WAITING to cancel" });
      return;
    }

    const { count } = await prisma.pass.updateMany({
      where: { id, status: { in: [PassStatus.PENDING, PassStatus.WAITING] } },
      data: {
        status: PassStatus.CANCELLED,
        cancellerId: user.id,
        cancelledAt: new Date(),
      },
    });

    if (count === 0) {
      res.status(409).json({ message: "Pass is no longer cancellable" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id } });

    emitPassEvent(updated, "pass:cancelled");

    res.json(updated);
  },
);

export default router;
