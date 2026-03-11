import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { DestinationResponse } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams } from "../middleware/validate";
import { requireSchoolAccess } from "../middleware/schoolScope";
import { createDestinationSchema, destinationIdSchema, updateDestinationSchema } from "../schemas/destination";

const router = Router({ mergeParams: true });

const DESTINATION_SELECT = {
  id: true,
  schoolId: true,
  name: true,
  maxOccupancy: true,
} as const;

type DestinationRow = { id: string; schoolId: number; name: string; maxOccupancy: number | null };

function toDestinationResponse(d: DestinationRow): DestinationResponse {
  return { id: d.id, schoolId: d.schoolId, name: d.name, maxOccupancy: d.maxOccupancy };
}

router.get("/", requireAuth, requireSchoolAccess, async (req: Request, res: Response) => {
  const schoolId = Number(req.params.schoolId);
  const destinations = await prisma.destination.findMany({
    where: { schoolId, deletedAt: null },
    orderBy: { name: "asc" },
    select: DESTINATION_SELECT,
  });
  res.json(destinations.map(toDestinationResponse));
});

router.post(
  "/",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(createDestinationSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);

    const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    const destination = await prisma.destination.create({
      data: {
        schoolId,
        name: req.body.name,
        maxOccupancy: req.body.maxOccupancy ?? null,
      },
      select: DESTINATION_SELECT,
    });

    res.status(201).json(toDestinationResponse(destination));
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(destinationIdSchema),
  validateBody(updateDestinationSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = String(req.params.id);

    const existing = await prisma.destination.findFirst({
      where: { id, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Destination not found" });
      return;
    }

    const updated = await prisma.destination.update({
      where: { id },
      data: req.body,
      select: DESTINATION_SELECT,
    });

    res.json(toDestinationResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateParams(destinationIdSchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);
    const id = String(req.params.id);

    const existing = await prisma.destination.findFirst({
      where: { id, schoolId, deletedAt: null },
    });

    if (!existing) {
      res.status(404).json({ message: "Destination not found" });
      return;
    }

    await prisma.destination.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
