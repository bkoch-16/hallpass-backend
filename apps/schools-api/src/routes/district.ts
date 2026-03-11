import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { DistrictResponse, CursorPage } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import { createDistrictSchema, districtIdSchema, listDistrictsSchema, updateDistrictSchema } from "../schemas/district";

const router = Router();

const DISTRICT_SELECT = { id: true, name: true, createdAt: true, updatedAt: true } as const;

type DistrictRow = { id: number; name: string; createdAt: Date; updatedAt: Date };

function toDistrictResponse(d: DistrictRow): DistrictResponse {
  return { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

router.get(
  "/",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateQuery(listDistrictsSchema),
  async (req: Request, res: Response) => {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

    const districts = await prisma.district.findMany({
      where: { deletedAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: DISTRICT_SELECT,
    });

    const hasMore = districts.length > limit;
    const data = hasMore ? districts.slice(0, limit) : districts;
    const nextCursor = hasMore ? String(data[data.length - 1].id) : null;

    res.json({ data: data.map(toDistrictResponse), nextCursor } satisfies CursorPage<DistrictResponse>);
  },
);

router.post(
  "/",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(createDistrictSchema),
  async (req: Request, res: Response) => {
    const district = await prisma.district.create({
      data: { name: req.body.name },
      select: DISTRICT_SELECT,
    });
    res.status(201).json(toDistrictResponse(district));
  },
);

router.get(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(districtIdSchema),
  async (req: Request, res: Response) => {
    const district = await prisma.district.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
      select: DISTRICT_SELECT,
    });

    if (!district) {
      res.status(404).json({ message: "District not found" });
      return;
    }

    res.json(toDistrictResponse(district));
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(districtIdSchema),
  validateBody(updateDistrictSchema),
  async (req: Request, res: Response) => {
    const district = await prisma.district.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
    });

    if (!district) {
      res.status(404).json({ message: "District not found" });
      return;
    }

    const updated = await prisma.district.update({
      where: { id: Number(req.params.id) },
      data: req.body,
      select: DISTRICT_SELECT,
    });

    res.json(toDistrictResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(districtIdSchema),
  async (req: Request, res: Response) => {
    const district = await prisma.district.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
    });

    if (!district) {
      res.status(404).json({ message: "District not found" });
      return;
    }

    await prisma.district.update({
      where: { id: Number(req.params.id) },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
