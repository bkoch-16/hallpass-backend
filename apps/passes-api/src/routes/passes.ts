import { Router, Request, Response } from "express";
import { prisma, PassStatus, type Prisma } from "@hallpass/db";
import { UserRole, type CursorPage, type PassResponse, type ParentLookupPass, type ParentLookupResponse } from "@hallpass/types";
import { logger } from "@hallpass/logger";
import { requireAuth } from "../middleware/auth.js";
import { requireSchool } from "../middleware/requireSchool.js";
import { requireMinRole, roleRank } from "@hallpass/express-middleware";
import { createRequireApiKey } from "../middleware/apiKey.js";
import { createPinLookupLimiter } from "../middleware/pinLookupLimiter.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "@hallpass/express-middleware";
import {
  createPassBody,
  approvePassBody,
  denyPassBody,
  passIdParams,
  listPassesQuery,
  parentLookupQuery,
} from "../schemas/passes.js";
import {
  claimPassSlots,
  releasePassSlots,
  releaseAndPromote,
  getMaxActivePasses,
} from "../lib/slots.js";
import { emitPassEvent } from "../lib/socket.js";
import { scheduleLocalExpiry } from "../lib/expiry.js";
import { paginate } from "../lib/pagination.js";
import {
  periodEndDate,
  getTodayInTimezone,
  getCurrentTimeInTimezone,
  getIntervalStart,
  addMinutesToTime,
  addMinutesToTimeClamped,
  calendarDate,
} from "../lib/time.js";
import { env } from "../env.js";

const router = Router({ mergeParams: true });

const PASS_SELECT = {
  id: true,
  schoolId: true,
  studentId: true,
  requesterId: true,
  destinationId: true,
  periodId: true,
  approverId: true,
  denierId: true,
  cancellerId: true,
  status: true,
  note: true,
  approverNote: true,
  denierNote: true,
  requestedAt: true,
  approvedAt: true,
  activatedAt: true,
  returnedAt: true,
  cancelledAt: true,
  deniedAt: true,
  expiredAt: true,
} as const;

type PassRow = Prisma.PassGetPayload<{ select: typeof PASS_SELECT }>;

// PassRow is derived from PASS_SELECT, so this passthrough is where the
// compiler verifies the select list matches the PassResponse wire contract.
function toPassResponse(pass: PassRow): PassResponse {
  return pass;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null && typeof err === "object" && "code" in err && err.code === "P2002"
  );
}

// Works because "HH:MM" strings are zero-padded and equal-length.
function timeLeq(a: string, b: string): boolean {
  return a <= b;
}

// POST /passes — students create their own pass (PENDING); TEACHER+ create a
// pass on behalf of a student (auto-approved: ACTIVE, or WAITING when full)
router.post(
  "/",
  requireAuth,
  requireSchool,
  validateBody(createPassBody),
  async (req: Request, res: Response) => {
    const user = req.user!;
    const schoolId = user.schoolId!;
    const isTeacherOrAbove = roleRank(user.role) >= roleRank(UserRole.TEACHER);

    // 1. Resolve school timezone
    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { timezone: true },
    });
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }
    const timezone = school.timezone;

    // 2. Get today's date in school timezone
    const today = getTodayInTimezone(timezone);
    const todayDate = calendarDate(today);

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
      // Buffer windows of adjacent periods overlap — order so the earliest match wins deterministically
      orderBy: { startTime: "asc" },
    });

    const activePeriod = periods.find((p) => {
      // Clamped, not wrapped: a period starting just after midnight must yield
      // a "00:00" window start, not wrap to "23:xx" and never match
      const windowStart = addMinutesToTimeClamped(
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

    // 6. Resolve the target student. Students always request for themselves
    // (body.studentId is ignored); TEACHER+ must name the student the pass is for.
    let studentId = user.id;
    if (isTeacherOrAbove) {
      if (req.body.studentId === undefined) {
        res.status(400).json({ message: "studentId is required" });
        return;
      }
      const student = await prisma.user.findFirst({
        where: {
          id: req.body.studentId,
          schoolId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
      });
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }
      studentId = student.id;
    }

    // 7. Check PassPolicy — the target student always burns their own quota;
    // only count in-flight/completed passes; denied/expired/cancelled don't burn quota
    //
    // TOCTOU: this count-then-create window can race, but the one_active_pass_per_student
    // partial unique index makes two concurrent NON-TERMINAL creates impossible — the loser
    // hits Prisma P2002 → 409 "Active pass already exists" (see the create below). So quota
    // can be exceeded by at most one, which self-corrects once a pass reaches a terminal
    // status. Accepted; no serializable transaction needed.
    const policy = await prisma.passPolicy.findFirst({ where: { schoolId } });

    if (policy && policy.interval && policy.maxPerInterval !== null) {
      const intervalStart = getIntervalStart(policy.interval, timezone);
      const passCount = await prisma.pass.count({
        where: {
          studentId,
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

    // 8. Validate destination belongs to this school
    const destination = await prisma.destination.findFirst({
      where: { id: req.body.destinationId, schoolId, deletedAt: null },
    });
    if (!destination) {
      res.status(404).json({ message: "Destination not found" });
      return;
    }

    // 9. Create pass. Student flow: PENDING (slot is claimed at approve step).
    // Teacher flow: the creation is the approval — claim a slot up front and
    // create in the final state (ACTIVE, or WAITING when the destination is full).
    let pass;
    if (!isTeacherOrAbove) {
      try {
        pass = await prisma.pass.create({
          data: {
            schoolId,
            studentId,
            requesterId: user.id,
            destinationId: destination.id,
            periodId: activePeriod.id,
            note: req.body.note,
            status: PassStatus.PENDING,
          },
          select: PASS_SELECT,
        });
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ message: "Active pass already exists" });
          return;
        }
        throw err;
      }
      emitPassEvent(pass, "pass:requested");
    } else {
      const slotClaimed =
        (await claimPassSlots(
          schoolId,
          policy?.maxActivePasses ?? null,
          destination.id,
          destination.maxOccupancy,
        )) === "claimed";
      const now = new Date();
      try {
        pass = await prisma.pass.create({
          data: {
            schoolId,
            studentId,
            requesterId: user.id,
            destinationId: destination.id,
            periodId: activePeriod.id,
            note: req.body.note,
            status: slotClaimed ? PassStatus.ACTIVE : PassStatus.WAITING,
            approverId: user.id,
            approvedAt: now,
            ...(slotClaimed ? { activatedAt: now } : {}),
          },
          select: PASS_SELECT,
        });
      } catch (err: unknown) {
        if (slotClaimed) {
          try {
            await releasePassSlots(
              schoolId,
              policy?.maxActivePasses ?? null,
              destination.id,
              destination.maxOccupancy,
            );
          } catch (releaseErr) {
            logger.error(releaseErr, "Failed to release slot after teacher-create error");
          }
        }
        if (isUniqueViolation(err)) {
          res.status(409).json({ message: "Active pass already exists" });
          return;
        }
        throw err;
      }
      emitPassEvent(pass, slotClaimed ? "pass:approved" : "pass:waiting");
    }

    scheduleLocalExpiry(
      pass.id,
      periodEndDate(
        activePeriod.endTime,
        activePeriod.scheduleType?.endBuffer ?? 0,
        timezone,
      ),
    );

    res.status(201).json(toPassResponse(pass));
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
    const { status, cursor, limit } = req.query as unknown as {
      status?: string;
      cursor?: string;
      limit: number;
    };
    const take = limit;
    const isStudent = user.role === UserRole.STUDENT;
    const where: Record<string, unknown> = {
      schoolId: user.schoolId!,
      ...(status ? { status } : {}),
      ...(isStudent ? { studentId: user.id } : {}),
    };

    const passes = await prisma.pass.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      orderBy: { id: "desc" },
      select: PASS_SELECT,
    });

    const { data, nextCursor } = paginate(passes, take);

    res.json({
      data: data.map(toPassResponse),
      nextCursor,
    } satisfies CursorPage<PassResponse>);
  },
);

// GET /passes/parent-lookup — external voice-AI agent verifies a parent via
// student PIN and retrieves that student's recent pass activity. New trust
// boundary for an external caller with no session: no requireAuth/requireSchool.
// Registered BEFORE /:id or Express's greedy param matcher would swallow this path.
const pinLookupLimiter = createPinLookupLimiter();

router.get(
  "/parent-lookup",
  createRequireApiKey(env.PARENT_TOOL_API_KEY),
  pinLookupLimiter,
  validateQuery(parentLookupQuery),
  async (req: Request, res: Response) => {
    const { pin, cursor, limit } = req.query as unknown as {
      pin: string;
      cursor?: string;
      limit: number;
    };
    const take = limit;

    const student = await prisma.user.findFirst({
      where: { pinCode: pin, role: UserRole.STUDENT, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    const passes = await prisma.pass.findMany({
      where: { studentId: student.id },
      take: take + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      orderBy: { id: "desc" },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        activatedAt: true,
        returnedAt: true,
        destination: { select: { name: true } },
      },
    });

    const { data, nextCursor } = paginate(passes, take);

    const parentLookupPasses: ParentLookupPass[] = data.map((pass) => ({
      id: pass.id,
      destination: pass.destination.name,
      status: pass.status,
      requestedAt: pass.requestedAt,
      activatedAt: pass.activatedAt,
      returnedAt: pass.returnedAt,
      durationMinutes:
        pass.activatedAt && pass.returnedAt
          ? Math.round(
              (pass.returnedAt.getTime() - pass.activatedAt.getTime()) / 60000,
            )
          : null,
    }));

    res.json({
      student,
      passes: parentLookupPasses,
      nextCursor,
    } satisfies ParentLookupResponse);
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
      select: PASS_SELECT,
    });

    if (!pass) {
      res.status(404).json({ message: "Pass not found" });
      return;
    }

    res.json(toPassResponse(pass));
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
    const maxActivePasses = await getMaxActivePasses(user.schoolId!);
    const slotClaimed =
      (await claimPassSlots(
        user.schoolId!,
        maxActivePasses,
        pass.destinationId,
        maxOccupancy,
      )) === "claimed";
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
          await releasePassSlots(user.schoolId!, maxActivePasses, pass.destinationId, maxOccupancy);
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
          await releasePassSlots(user.schoolId!, maxActivePasses, pass.destinationId, maxOccupancy);
        } catch (releaseErr) {
          logger.error(releaseErr, "Failed to release slot after lost approve race");
        }
      }
      res.status(409).json({ message: "Pass is no longer PENDING" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id }, select: PASS_SELECT });

    if (updated.status === PassStatus.ACTIVE) {
      emitPassEvent(updated, "pass:approved");
    } else if (updated.status === PassStatus.WAITING) {
      emitPassEvent(updated, "pass:waiting");
    }

    res.json(toPassResponse(updated));
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
        ...(req.body.denierNote !== undefined
          ? { denierNote: req.body.denierNote }
          : {}),
      },
    });

    if (count === 0) {
      res.status(409).json({ message: "Pass is no longer PENDING" });
      return;
    }

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id }, select: PASS_SELECT });

    emitPassEvent(updated, "pass:denied");

    res.json(toPassResponse(updated));
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

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id }, select: PASS_SELECT });

    emitPassEvent(updated, "pass:returned");

    // The return already succeeded — a slot bookkeeping failure must not turn
    // the response into a 500; reconcile-expiry recovers the counter
    try {
      await releaseAndPromote(pass.schoolId, pass.destinationId, pass.destination.maxOccupancy);
    } catch (err) {
      logger.error(err, "Failed to release/promote after return — will be recovered by reconcile");
    }

    res.json(toPassResponse(updated));
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

    const updated = await prisma.pass.findUniqueOrThrow({ where: { id }, select: PASS_SELECT });

    emitPassEvent(updated, "pass:cancelled");

    res.json(toPassResponse(updated));
  },
);

export default router;
