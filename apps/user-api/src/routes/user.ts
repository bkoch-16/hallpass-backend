import { Router, Request, Response } from "express";
import { prisma, Role } from "@hallpass/db";
import { requireAuth } from "../middleware/auth";
import { requireRole, requireSelfOrRole, roleRank } from "../middleware/roleGuard";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  bulkCreateSchema,
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
  userIdSchema,
} from "../schemas/user";

const router = Router();

// GET /me — must come before /:id
router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json(req.user);
});

// GET / — cursor-paginated list; ?ids= replaces the former /batch endpoint
router.get(
  "/",
  requireAuth,
  requireRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN),
  validateQuery(listUsersSchema),
  async (req: Request, res: Response) => {
    const { role, cursor, ids } = req.query as {
      role?: string;
      cursor?: string;
      ids?: string;
    };
    const take = Math.min(parseInt((req.query.limit as string) ?? "50", 10) || 50, 100);

    if (ids) {
      const idList = ids.split(",").map((id) => id.trim()).filter(Boolean);
      if (idList.length > 100) {
        res.status(400).json({ message: "Too many IDs (max 100)" });
        return;
      }
      const users = await prisma.user.findMany({
        where: { id: { in: idList }, deletedAt: null },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
      res.json({ data: users, nextCursor: null });
      return;
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (role) where.role = role;

    const users = await prisma.user.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    const hasMore = users.length > take;
    const data = hasMore ? users.slice(0, take) : users;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    res.json({ data, nextCursor });
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
      select: { id: true, email: true, name: true, role: true, createdAt: true },
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
      data: { email: req.body.email, name: req.body.name, role: targetRole },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.status(201).json(user);
  },
);

router.post(
  "/bulk",
  requireAuth,
  validateBody(bulkCreateSchema),
  requireRole(Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const users: Array<{ email: string; name: string; role?: string }> = req.body;
    const callerRank = roleRank(req.user!.role as Role);

    for (const u of users) {
      if (roleRank((u.role ?? Role.STUDENT) as Role) > callerRank) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }

    const results = await Promise.allSettled(
      users.map((u) =>
        prisma.user.create({
          data: { email: u.email, name: u.name, role: (u.role as Role) ?? Role.STUDENT },
          select: { id: true, email: true, name: true, role: true, createdAt: true },
        }),
      ),
    );

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .map((r, i) => ({ result: r, index: i }))
      .filter(({ result }) => result.status === "rejected")
      .map(({ index }) => ({ index, email: users[index].email, error: "Failed to create user" }));

    res.status(failed.length === users.length ? 400 : 200).json({ created, failed });
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

    if (req.body.email && roleRank(req.user!.role as Role) < roleRank(Role.ADMIN)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    if (req.body.role && roleRank(req.body.role) > roleRank(req.user!.role as Role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data: req.body,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
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
