import { Router, Request, Response } from "express";
import { prisma, Prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { SchoolCalendarResponse, BulkUpsertResult } from "@hallpass/types";
import { requireAuth, requireAuthOrApiKey } from "../middleware/auth.js";
import { requireRole } from "@hallpass/express-middleware";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "@hallpass/express-middleware";
import {
  requireSchoolAccess,
  requireSchoolAccessIfSession,
} from "../middleware/schoolScope.js";
import { createPublicSchoolDataLimiter } from "../middleware/publicSchoolDataLimiter.js";
import {
  calendarBulkSchema,
  calendarIdSchema,
  calendarQuerySchema,
  updateCalendarSchema,
} from "../schemas/calendar.js";
import { schoolParamSchema } from "../schemas/school.js";

const publicSchoolDataLimiter = createPublicSchoolDataLimiter();

const router = Router({ mergeParams: true });

const CALENDAR_SELECT = {
  id: true,
  schoolId: true,
  date: true,
  scheduleTypeId: true,
  note: true,
} as const;

type CalendarRow = {
  id: number;
  schoolId: number;
  date: Date;
  scheduleTypeId: number | null;
  note: string | null;
};

function toCalendarResponse(c: CalendarRow): SchoolCalendarResponse {
  return {
    id: c.id,
    schoolId: c.schoolId,
    date: c.date,
    scheduleTypeId: c.scheduleTypeId,
    note: c.note,
  };
}

router.get(
  "/",
  requireAuthOrApiKey,
  validateParams(schoolParamSchema),
  requireSchoolAccessIfSession,
  (req, res, next) => (req.user ? next() : publicSchoolDataLimiter(req, res, next)),
  validateQuery(calendarQuerySchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const { from, to } = req.query as unknown as { from?: string; to?: string };

    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const entries = await prisma.schoolCalendar.findMany({
      where: {
        schoolId,
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
      },
      orderBy: { date: "asc" },
      select: CALENDAR_SELECT,
    });

    res.json(entries.map(toCalendarResponse));
  },
);

router.post(
  "/",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(calendarBulkSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const entries = Array.isArray(req.body) ? req.body : [req.body];

    // Validate every referenced schedule type up front, in one query, before
    // any write — so a bad id returns 422 without leaving partial state.
    const byDate = new Map<
      number,
      { date: Date; scheduleTypeId: number | null; note: string | null }
    >();
    for (const e of entries) {
      const date = new Date(e.date);
      if (byDate.has(date.getTime())) {
        res
          .status(422)
          .json({ message: `Duplicate date ${e.date} in request` });
        return;
      }
      byDate.set(date.getTime(), {
        date,
        scheduleTypeId: e.scheduleTypeId ?? null,
        note: e.note ?? null,
      });
    }
    const validatedEntries = [...byDate.values()];

    const scheduleTypeIds = [
      ...new Set(
        validatedEntries
          .filter((e) => e.scheduleTypeId != null)
          .map((e) => Number(e.scheduleTypeId)),
      ),
    ];
    if (scheduleTypeIds.length) {
      const scheduleTypes = await prisma.scheduleType.findMany({
        where: { id: { in: scheduleTypeIds }, schoolId },
      });
      const byId = new Map(scheduleTypes.map((st) => [st.id, st]));
      for (const id of scheduleTypeIds) {
        const scheduleType = byId.get(id);
        if (!scheduleType) {
          res
            .status(422)
            .json({ message: `Schedule type ${id} not found for this school` });
          return;
        }
        if (scheduleType.deletedAt !== null) {
          res
            .status(422)
            .json({ message: `Schedule type ${id} has been deleted` });
          return;
        }
      }
    }

    const values = Prisma.join(
      validatedEntries.map(
        (e) =>
          Prisma.sql`(${schoolId}, ${e.date}, ${e.scheduleTypeId}, ${e.note})`,
      ),
    );
    const rows = await prisma.$queryRaw<{ inserted: boolean }[]>(
      Prisma.sql`INSERT INTO "SchoolCalendar" ("schoolId", "date", "scheduleTypeId", "note")
                 VALUES ${values}
                 ON CONFLICT ("schoolId", "date")
                 DO UPDATE SET "scheduleTypeId" = EXCLUDED."scheduleTypeId", "note" = EXCLUDED."note"
                 RETURNING (xmax = 0) AS inserted`,
    );
    const created = rows.filter((r) => r.inserted).length;
    const updated = rows.length - created;

    res.status(200).json({ created, updated } satisfies BulkUpsertResult);
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(calendarIdSchema),
  validateBody(updateCalendarSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = Number(req.params.id);

    const existing = await prisma.schoolCalendar.findFirst({
      where: { id, schoolId },
    });

    if (!existing) {
      res.status(404).json({ message: "Calendar entry not found" });
      return;
    }

    if (req.body.scheduleTypeId) {
      const scheduleType = await prisma.scheduleType.findFirst({
        where: { id: Number(req.body.scheduleTypeId), schoolId },
      });
      if (!scheduleType) {
        res
          .status(422)
          .json({
            message: `Schedule type ${req.body.scheduleTypeId} not found for this school`,
          });
        return;
      }
      if (scheduleType.deletedAt !== null) {
        res
          .status(422)
          .json({
            message: `Schedule type ${req.body.scheduleTypeId} has been deleted`,
          });
        return;
      }
    }

    const updated = await prisma.schoolCalendar.update({
      where: { id },
      data: req.body,
      select: CALENDAR_SELECT,
    });

    res.json(toCalendarResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(calendarIdSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = Number(req.params.id);

    const existing = await prisma.schoolCalendar.findFirst({
      where: { id, schoolId },
    });

    if (!existing) {
      res.status(404).json({ message: "Calendar entry not found" });
      return;
    }

    await prisma.schoolCalendar.delete({ where: { id } });

    res.status(204).send();
  },
);

export default router;
