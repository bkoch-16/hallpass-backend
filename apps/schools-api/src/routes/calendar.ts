import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { SchoolCalendarResponse, BulkUpsertResult } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import { requireSchoolAccess } from "../middleware/schoolScope";
import { calendarBulkSchema, calendarIdSchema, calendarQuerySchema, updateCalendarSchema } from "../schemas/calendar";

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

    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      if (entry.scheduleTypeId) {
        const scheduleType = await prisma.scheduleType.findFirst({
          where: { id: Number(entry.scheduleTypeId), schoolId },
        });
        if (!scheduleType) {
          res.status(422).json({ message: `Schedule type ${entry.scheduleTypeId} not found for this school` });
          return;
        }
        if (scheduleType.deletedAt !== null) {
          res.status(422).json({ message: `Schedule type ${entry.scheduleTypeId} has been deleted` });
          return;
        }
      }

      const date = new Date(entry.date);

      const existing = await prisma.schoolCalendar.findUnique({
        where: { schoolId_date: { schoolId, date } },
      });

      if (existing) {
        await prisma.schoolCalendar.update({
          where: { schoolId_date: { schoolId, date } },
          data: {
            scheduleTypeId: entry.scheduleTypeId ?? null,
            note: entry.note ?? null,
          },
        });
        updated++;
      } else {
        await prisma.schoolCalendar.create({
          data: {
            schoolId,
            date,
            scheduleTypeId: entry.scheduleTypeId ?? null,
            note: entry.note ?? null,
          },
        });
        created++;
      }
    }

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
