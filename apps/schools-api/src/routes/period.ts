import { Router, Request, Response } from "express";
import { prisma, IN_FLIGHT_PASS_STATUSES } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { PeriodResponse } from "@hallpass/types";
import { requireAuth, requireAuthOrApiKey } from "../middleware/auth.js";
import { requireRole } from "@hallpass/express-middleware";
import { validateBody, validateParams } from "@hallpass/express-middleware";
import {
  requireSchoolAccess,
  requireSchoolAccessIfSession,
} from "../middleware/schoolScope.js";
import { createPublicSchoolDataLimiter } from "../middleware/publicSchoolDataLimiter.js";
import {
  createPeriodSchema,
  isValidTimeRange,
  PERIOD_TIME_ORDER_MESSAGE,
  periodIdSchema,
  periodListParamsSchema,
  updatePeriodSchema,
} from "../schemas/period.js";
import { blockIfExists } from "../lib/deleteGuard.js";

const publicSchoolDataLimiter = createPublicSchoolDataLimiter();

const router = Router({ mergeParams: true });

const PERIOD_SELECT = {
  id: true,
  scheduleTypeId: true,
  name: true,
  startTime: true,
  endTime: true,
  order: true,
} as const;

type PeriodRow = { id: number; scheduleTypeId: number; name: string; startTime: string; endTime: string; order: number };

function toPeriodResponse(p: PeriodRow): PeriodResponse {
  return { id: p.id, scheduleTypeId: p.scheduleTypeId, name: p.name, startTime: p.startTime, endTime: p.endTime, order: p.order };
}

router.get(
  "/",
  requireAuthOrApiKey,
  validateParams(periodListParamsSchema),
  requireSchoolAccessIfSession,
  (req, res, next) => (req.user ? next() : publicSchoolDataLimiter(req, res, next)),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = Number(req.params.scheduleTypeId);

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
  },
);

router.post(
  "/",
  requireAuth,
  validateParams(periodListParamsSchema),
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(createPeriodSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = Number(req.params.scheduleTypeId);

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
  validateParams(periodIdSchema),
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(updatePeriodSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = Number(req.params.scheduleTypeId);
    const id = Number(req.params.id);

    const existing = await prisma.period.findFirst({
      where: { id, scheduleTypeId, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Period not found" });
      return;
    }

    const isChangingTimes = req.body.startTime !== undefined || req.body.endTime !== undefined;

    if (isChangingTimes) {
      const mergedStartTime = req.body.startTime ?? existing.startTime;
      const mergedEndTime = req.body.endTime ?? existing.endTime;

      if (!isValidTimeRange(mergedStartTime, mergedEndTime)) {
        res.status(422).json({ message: PERIOD_TIME_ORDER_MESSAGE });
        return;
      }
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
  validateParams(periodIdSchema),
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const scheduleTypeId = Number(req.params.scheduleTypeId);
    const id = Number(req.params.id);

    const existing = await prisma.period.findFirst({
      where: { id, scheduleTypeId, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Period not found" });
      return;
    }

    if (
      await blockIfExists(
        res,
        () => prisma.pass.findFirst({ where: { periodId: id, status: { in: IN_FLIGHT_PASS_STATUSES } } }),
        "Cannot delete: period has in-flight passes",
      )
    ) {
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
