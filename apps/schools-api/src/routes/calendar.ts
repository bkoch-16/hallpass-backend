import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { SchoolCalendarResponse, BulkUpsertResult } from "@hallpass/types";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "@hallpass/express-middleware";
import { validateBody, validateParams, validateQuery } from "@hallpass/express-middleware";
import { requireSchoolAccess } from "../middleware/schoolScope.js";
import { calendarBulkSchema, calendarIdSchema, calendarQuerySchema, updateCalendarSchema } from "../schemas/calendar.js";

const router = Router({ mergeParams: true });

const CALENDAR_SELECT = {
  id: true,
  schoolId: true,
  date: true,
  scheduleTypeId: true,
  note: true,
} as const;

type CalendarRow = { id: number; schoolId: number; date: Date; scheduleTypeId: number | null; note: string | null };

function toCalendarResponse(c: CalendarRow): SchoolCalendarResponse {
  return { id: c.id, schoolId: c.schoolId, date: c.date, scheduleTypeId: c.scheduleTypeId, note: c.note };
}

router.get(
  "/",
  requireAuth,
  requireSchoolAccess,
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
    const byDate = new Map<number, { date: Date; scheduleTypeId: number | null; note: string | null }>();
    for (const e of entries) {
      const date = new Date(e.date);
      byDate.set(date.getTime(), {
        date,
        scheduleTypeId: e.scheduleTypeId ?? null,
        note: e.note ?? null,
      });
    }
    const dedupedEntries = [...byDate.values()];

    const scheduleTypeIds = [
      ...new Set(
        dedupedEntries.filter((e) => e.scheduleTypeId != null).map((e) => Number(e.scheduleTypeId)),
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
          res.status(422).json({ message: `Schedule type ${id} not found for this school` });
          return;
        }
        if (scheduleType.deletedAt !== null) {
          res.status(422).json({ message: `Schedule type ${id} has been deleted` });
          return;
        }
      }
    }

    const existing = await prisma.schoolCalendar.findMany({
      where: { schoolId, date: { in: dedupedEntries.map((e) => e.date) } },
      select: { date: true },
    });
    const existingDates = new Set(existing.map((e) => e.date.getTime()));

    let created = 0;
    let updated = 0;
    for (const entry of dedupedEntries) {
      if (existingDates.has(entry.date.getTime())) {
        updated++;
      } else {
        created++;
      }
    }

    await prisma.$transaction(
      dedupedEntries.map((entry) => {
        const data = { scheduleTypeId: entry.scheduleTypeId, note: entry.note };
        return prisma.schoolCalendar.upsert({
          where: { schoolId_date: { schoolId, date: entry.date } },
          update: data,
          create: { schoolId, date: entry.date, ...data },
        });
      }),
    );

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
        res.status(422).json({ message: `Schedule type ${req.body.scheduleTypeId} not found for this school` });
        return;
      }
      if (scheduleType.deletedAt !== null) {
        res.status(422).json({ message: `Schedule type ${req.body.scheduleTypeId} has been deleted` });
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
