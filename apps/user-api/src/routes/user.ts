import { Router, Request, Response } from "express";
import { prisma, Role } from "@hallpass/db";
import { requireAuth } from "../middleware/auth";
import { requireRole, requireSelfOrRole, roleRank } from "../middleware/roleGuard";
import {validateBody, validateParams, validateQuery} from "../middleware/validate";
import { batchQuerySchema, createUserSchema, updateUserSchema, userIdSchema } from "../schemas/user";

const router = Router();

// batch must come before /:id
router.get(
  "/batch",
  requireAuth,
  validateQuery(batchQuerySchema),
  requireRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN),
    async (req: Request, res: Response) => {
    const idList = (req.query.ids as string).split(",").filter(Boolean);
    if (idList.length > 100) {
      res.status(400).json({ message: "Too many IDs (max 100)" });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        id: { in: idList },
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(users);
  },
);

router.get(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireSelfOrRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  },
);

router.post(
  "/",
  requireAuth,
  validateBody(createUserSchema),
  requireRole(Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const targetRole = req.body.role ?? Role.STUDENT;
    if (roleRank(targetRole) > roleRank(req.user!.role as Role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        name: req.body.name,
        role: targetRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  },
);

router.patch(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  validateBody(updateUserSchema),
  requireSelfOrRole(Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (req.body.role && roleRank(req.body.role) > roleRank(req.user!.role as Role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data: req.body,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(updated);
  },
);

router.delete(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireRole(Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (roleRank(user.role as Role) >= roleRank(req.user!.role as Role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    await prisma.user.update({
      where: { id: req.params.id as string },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  },
);

export default router;
