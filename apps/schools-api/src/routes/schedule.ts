import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import type { ScheduleTodayResponse, ScheduleTypeResponse, PeriodResponse } from "@hallpass/types";
import { requireAuth } from "../middleware/auth.js";
import { validateParams } from "@hallpass/express-middleware";
import { requireSchoolAccess } from "../middleware/schoolScope.js";
import { schoolParamSchema } from "../schemas/school.js";
import { resolveSchedule, getTodayInTimezone, calendarDate } from "@hallpass/schedule";

const router = Router({ mergeParams: true });

// GET /today — today's schedule and current period for the school, in the
// school's timezone. Backed by the same resolver POST /api/passes uses to
// find the active period (@hallpass/schedule).
router.get(
  "/today",
  requireAuth,
  validateParams(schoolParamSchema),
  requireSchoolAccess,
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);

    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { timezone: true },
    });
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    const now = new Date();
    const todayDate = calendarDate(getTodayInTimezone(school.timezone, now));

    const calendarEntry = await prisma.schoolCalendar.findFirst({
      where: { schoolId, date: todayDate },
    });

    // No calendar entry (or one with no schedule type) is a normal "no school
    // today" day, not a missing-resource error — respond 200 with an empty schedule.
    let scheduleType: ScheduleTypeResponse | null = null;
    let periods: PeriodResponse[] = [];

    if (calendarEntry?.scheduleTypeId != null) {
      scheduleType = await prisma.scheduleType.findFirst({
        where: { id: calendarEntry.scheduleTypeId, schoolId, deletedAt: null },
        select: {
          id: true,
          schoolId: true,
          name: true,
          startBuffer: true,
          endBuffer: true,
        },
      });

      if (scheduleType) {
        periods = await prisma.period.findMany({
          where: { scheduleTypeId: scheduleType.id, schoolId, deletedAt: null },
          orderBy: { order: "asc" },
          select: {
            id: true,
            scheduleTypeId: true,
            name: true,
            startTime: true,
            endTime: true,
            order: true,
          },
        });
      }
    }

    const resolved = resolveSchedule({
      calendarEntry: calendarEntry
        ? { scheduleTypeId: calendarEntry.scheduleTypeId }
        : null,
      scheduleType,
      periods,
      timezone: school.timezone,
      now,
    });

    res.json({
      date: resolved.date,
      scheduleType,
      periods: resolved.periods,
      currentPeriod: resolved.currentPeriod,
    } satisfies ScheduleTodayResponse);
  },
);

export default router;
