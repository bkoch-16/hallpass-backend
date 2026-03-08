import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { UserResponse, CursorPage, BulkUserResult } from "@hallpass/types";
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

const USER_SELECT = { id: true, email: true, name: true, role: true, createdAt: true } as const;

type UserRow = { id: string; email: string; name: string | null; role: UserRole; createdAt: Date };

function toUserResponse(u: UserRow): UserResponse {
    // Hardcode schoolId and districtId as null until their schema are added
    return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, schoolId: null, districtId: null };
}

// GET /me — must come before /:id
router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json(toUserResponse(req.user!));
});

// GET / — cursor-paginated list; ?ids= replaces the former /batch endpoint
router.get(
  "/",
  requireAuth,
  requireRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateQuery(listUsersSchema),
  async (req: Request, res: Response) => {
    const { role, cursor, ids, limit } = req.query as unknown as {
      role?: string;
      cursor?: string;
      ids?: string;
      limit: number;
    };
    const take = limit;

    if (ids) {
      const idList = ids.split(",").map((id) => id.trim()).filter(Boolean);
      if (idList.length > 100) {
        res.status(400).json({ message: "Too many IDs (max 100)" });
        return;
      }
      const users = await prisma.user.findMany({
        where: { id: { in: idList }, deletedAt: null },
        select: USER_SELECT,
      });
      res.json({ data: users.map(toUserResponse), nextCursor: null } satisfies CursorPage<UserResponse>);
      return;
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (role) where.role = role;

    const users = await prisma.user.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: USER_SELECT,
    });

    const hasMore = users.length > take;
    const data = hasMore ? users.slice(0, take) : users;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    res.json({ data: data.map(toUserResponse), nextCursor } satisfies CursorPage<UserResponse>);
  },
);

router.get(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireSelfOrRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
      select: USER_SELECT,
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(toUserResponse(user));
  },
);

router.post(
  "/",
  requireAuth,
  validateBody(createUserSchema),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const targetRole: UserRole = req.body.role ?? UserRole.STUDENT;
    if (roleRank(targetRole) > roleRank(req.user!.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    try {
      const user = await prisma.user.create({
        data: { email: req.body.email, name: req.body.name, role: targetRole },
        select: USER_SELECT,
      });
      res.status(201).json(toUserResponse(user));
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        res.status(409).json({ message: "Email already in use" });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/bulk",
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(bulkCreateSchema),
  async (req: Request, res: Response) => {
    const users: Array<{ email: string; name: string; role?: UserRole }> = req.body;
    const callerRank = roleRank(req.user!.role);

    for (const u of users) {
      if (roleRank(u.role ?? "STUDENT") > callerRank) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }

    const results = await Promise.allSettled(
      users.map((u) =>
        prisma.user.create({
          data: { email: u.email, name: u.name, role: u.role ?? UserRole.STUDENT },
          select: USER_SELECT,
        }),
      ),
    );

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .map((r, i) => ({ result: r, index: i }))
      .filter(({ result }) => result.status === "rejected")
      .map(({ index }) => ({ index, email: users[index].email, error: "Failed to create user" }));

    res.status(failed.length === users.length ? 400 : 200).json({ created, failed } satisfies BulkUserResult);
  },
);

router.patch(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  validateBody(updateUserSchema),
  requireSelfOrRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (req.body.email && roleRank(req.user!.role) < roleRank(UserRole.ADMIN)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    if (req.body.role && roleRank(req.body.role) > roleRank(req.user!.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data: req.body,
      select: USER_SELECT,
    });

    res.json(toUserResponse(updated));
  },
);

router.delete(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id as string, deletedAt: null },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (roleRank(user.role as UserRole) >= roleRank(req.user!.role)) {
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
