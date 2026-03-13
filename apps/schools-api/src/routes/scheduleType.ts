import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { ScheduleTypeResponse } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams } from "../middleware/validate";
import { requireSchoolAccess } from "../middleware/schoolScope";
import { createScheduleTypeSchema, scheduleTypeIdSchema, updateScheduleTypeSchema } from "../schemas/scheduleType";

const router = Router({ mergeParams: true });

const SCHEDULE_TYPE_SELECT = {
  id: true,
  schoolId: true,
  name: true,
  startBuffer: true,
  endBuffer: true,
} as const;

type ScheduleTypeRow = { id: number; schoolId: number; name: string; startBuffer: number; endBuffer: number };

function toScheduleTypeResponse(s: ScheduleTypeRow): ScheduleTypeResponse {
  return { id: s.id, schoolId: s.schoolId, name: s.name, startBuffer: s.startBuffer, endBuffer: s.endBuffer };
}

router.get("/", requireAuth, requireSchoolAccess, async (req: Request, res: Response) => {
  const schoolId = Number(req.params.schoolId);
  const types = await prisma.scheduleType.findMany({
    where: { schoolId, deletedAt: null },
    orderBy: { name: "asc" },
    select: SCHEDULE_TYPE_SELECT,
  });
  res.json(types.map(toScheduleTypeResponse));
});

router.post(
  "/",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(createScheduleTypeSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);

    const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    const scheduleType = await prisma.scheduleType.create({
      data: {
        schoolId,
        name: req.body.name,
        ...(req.body.startBuffer !== undefined ? { startBuffer: req.body.startBuffer } : {}),
        ...(req.body.endBuffer !== undefined ? { endBuffer: req.body.endBuffer } : {}),
      },
      select: SCHEDULE_TYPE_SELECT,
    });

    res.status(201).json(toScheduleTypeResponse(scheduleType));
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(scheduleTypeIdSchema),
  validateBody(updateScheduleTypeSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = Number(req.params.id);

    const existing = await prisma.scheduleType.findFirst({
      where: { id, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Schedule type not found" });
      return;
    }

    const updated = await prisma.scheduleType.update({
      where: { id },
      data: req.body,
      select: SCHEDULE_TYPE_SELECT,
    });

    res.json(toScheduleTypeResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(scheduleTypeIdSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = Number(req.params.id);

    const existing = await prisma.scheduleType.findFirst({
      where: { id, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Schedule type not found" });
      return;
    }

    const calendarRef = await prisma.schoolCalendar.findFirst({
      where: { scheduleTypeId: id },
    });

    if (calendarRef) {
      res.status(409).json({ message: "Cannot delete: schedule type is referenced by calendar entries" });
      return;
    }

    await prisma.scheduleType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
