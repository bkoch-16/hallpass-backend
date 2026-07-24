import { Router, Request, Response } from "express";
import { prisma, IN_FLIGHT_PASS_STATUSES } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { SchoolResponse, CursorPage } from "@hallpass/types";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "@hallpass/express-middleware";
import { validateBody, validateParams, validateQuery } from "@hallpass/express-middleware";
import { createSchoolSchema, listSchoolsSchema, schoolIdSchema, updateSchoolSchema } from "../schemas/school.js";
import { blockIfExists } from "../lib/deleteGuard.js";

const router = Router({ mergeParams: true });

const SCHOOL_SELECT = { id: true, name: true, timezone: true, districtId: true, createdAt: true, updatedAt: true } as const;

type SchoolRow = { id: number; name: string; timezone: string; districtId: number | null; createdAt: Date; updatedAt: Date };

function toSchoolResponse(s: SchoolRow): SchoolResponse {
  return { id: s.id, name: s.name, timezone: s.timezone, districtId: s.districtId, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

router.get(
  "/",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateQuery(listSchoolsSchema),
  async (req: Request, res: Response) => {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

    const schools = await prisma.school.findMany({
      where: { deletedAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: SCHOOL_SELECT,
    });

    const hasMore = schools.length > limit;
    const data = hasMore ? schools.slice(0, limit) : schools;
    const nextCursor = hasMore ? String(data[data.length - 1].id) : null;

    res.json({ data: data.map(toSchoolResponse), nextCursor } satisfies CursorPage<SchoolResponse>);
  },
);

router.post(
  "/",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(createSchoolSchema),
  async (req: Request, res: Response) => {
    try {
      const school = await prisma.school.create({
        data: {
          name: req.body.name,
          ...(req.body.timezone ? { timezone: req.body.timezone } : {}),
          ...(req.body.districtId ? { districtId: req.body.districtId } : {}),
        },
        select: SCHOOL_SELECT,
      });
      res.status(201).json(toSchoolResponse(school));
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2003") {
        res.status(400).json({ message: "Invalid districtId" });
        return;
      }
      throw err;
    }
  },
);

router.get(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(schoolIdSchema),
  async (req: Request, res: Response) => {
    const school = await prisma.school.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
      select: SCHOOL_SELECT,
    });

    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    res.json(toSchoolResponse(school));
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(schoolIdSchema),
  validateBody(updateSchoolSchema),
  async (req: Request, res: Response) => {
    const school = await prisma.school.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
    });

    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    try {
      const updated = await prisma.school.update({
        where: { id: Number(req.params.id) },
        data: req.body,
        select: SCHOOL_SELECT,
      });
      res.json(toSchoolResponse(updated));
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2003") {
        res.status(400).json({ message: "Invalid districtId" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/:id",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  validateParams(schoolIdSchema),
  async (req: Request, res: Response) => {
    const school = await prisma.school.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
    });

    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    if (
      await blockIfExists(
        res,
        () => prisma.pass.findFirst({ where: { schoolId: school.id, status: { in: IN_FLIGHT_PASS_STATUSES } } }),
        "Cannot delete: school has in-flight passes",
      )
    ) {
      return;
    }

    if (
      await blockIfExists(
        res,
        () => prisma.user.findFirst({ where: { schoolId: school.id, deletedAt: null } }),
        "Cannot delete: school has active users",
      )
    ) {
      return;
    }

    await prisma.school.update({
      where: { id: Number(req.params.id) },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
