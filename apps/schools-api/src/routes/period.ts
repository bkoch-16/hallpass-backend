import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { PeriodResponse } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams } from "../middleware/validate";
import { requireSchoolAccess } from "../middleware/schoolScope";
import { createPeriodSchema, periodIdSchema, updatePeriodSchema } from "../schemas/period";

const router = Router({ mergeParams: true });

const PERIOD_SELECT = {
  id: true,
  scheduleTypeId: true,
  name: true,
  startTime: true,
  endTime: true,
  order: true,
} as const;

type PeriodRow = { id: string; scheduleTypeId: string; name: string; startTime: string; endTime: string; order: number };

function toPeriodResponse(p: PeriodRow): PeriodResponse {
  return { id: p.id, scheduleTypeId: p.scheduleTypeId, name: p.name, startTime: p.startTime, endTime: p.endTime, order: p.order };
}

router.get("/", requireAuth, requireSchoolAccess, async (req: Request, res: Response) => {
  const schoolId = Number(req.params.schoolId);
  const scheduleTypeId = String(req.params.scheduleTypeId);

  const scheduleType = await prisma.scheduleType.findFirst({
    where: { id: scheduleTypeId, schoolId, deletedAt: null },
  });

  if (!scheduleType) {
    res.status(404).json({ message: "Schedule type not found" });
    return;
  }

  const periods = await prisma.period.findMany({
    where: { scheduleTypeId, deletedAt: null },
    orderBy: { order: "asc" },
    select: PERIOD_SELECT,
  });

  res.json(periods.map(toPeriodResponse));
});

router.post(
  "/",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(createPeriodSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = String(req.params.scheduleTypeId);

    const scheduleType = await prisma.scheduleType.findFirst({
      where: { id: scheduleTypeId, schoolId, deletedAt: null },
    });

    if (!scheduleType) {
      res.status(404).json({ message: "Schedule type not found" });
      return;
    }

    const period = await prisma.period.create({
      data: {
        schoolId,
        scheduleTypeId,
        name: req.body.name,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        order: req.body.order,
      },
      select: PERIOD_SELECT,
    });

    res.status(201).json(toPeriodResponse(period));
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(periodIdSchema),
  validateBody(updatePeriodSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = String(req.params.scheduleTypeId);
    const id = String(req.params.id);

    const existing = await prisma.period.findFirst({
      where: { id, scheduleTypeId, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Period not found" });
      return;
    }

    const updated = await prisma.period.update({
      where: { id },
      data: req.body,
      select: PERIOD_SELECT,
    });

    res.json(toPeriodResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(periodIdSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = String(req.params.scheduleTypeId);
    const id = String(req.params.id);

    const existing = await prisma.period.findFirst({
      where: { id, scheduleTypeId, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Period not found" });
      return;
    }

    await prisma.period.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
