import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { logger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";
import { createUserWithCredential, createSetPasswordToken, EmailInUseError } from "@hallpass/auth";
import { inviteEmail } from "@hallpass/email";
import { UserRole } from "@hallpass/types";
import type { UserResponse, ProvisionUserResponse, CursorPage, BulkUserResult, MeResponse } from "@hallpass/types";
import { auth } from "../auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole, requireSelfOrRole, roleRank } from "@hallpass/express-middleware";
import { validateBody, validateParams, validateQuery, paginate, isPrismaError } from "@hallpass/express-middleware";
import { createUserWithPin } from "../lib/pin.js";
import { emailSender, resetPasswordUrl } from "../email.js";
import {
  bulkCreateSchema,
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
  userIdSchema,
} from "../schemas/user.js";

const router = Router();

const USER_SELECT = { id: true, email: true, name: true, role: true, schoolId: true, createdAt: true } as const;
const USER_SELECT_WITH_PIN = { ...USER_SELECT, pinCode: true } as const;

type UserRow = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  schoolId: number | null;
  createdAt: Date;
  pinCode?: string | null;
};

function toUserResponse(u: UserRow): UserResponse {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    schoolId: u.schoolId,
    createdAt: u.createdAt,
    ...(u.pinCode !== undefined ? { pinCode: u.pinCode } : {}),
  };
}

// Server-generated one-time password. 24 url-safe base64 chars — comfortably
// above better-auth's 8-char minimum. Never logged; returned to the caller once.
function generateTempPassword(): string {
  return randomBytes(18).toString("base64url");
}

// Students need a unique pinCode for the parent voice tool, but
// createUserWithCredential can't set it (better-auth additionalFields cover only
// role/schoolId). Assign the pin right after creation; a collision retries only
// this update, never the user creation itself.
async function assignPin(userId: number, role: UserRole): Promise<void> {
  await createUserWithPin(role, async (pinCode) => {
    if (!pinCode) return;
    await prisma.user.update({ where: { id: userId }, data: { pinCode } });
  });
}

// Invite link expiry — a better-auth reset-password token minted server-side.
const INVITE_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

// Mints a set-password token and emails it as an invite. Callers wrap this in
// a try/catch (see assignPin above): the user row is already committed, so an
// email failure must not turn an already-created account into a 500.
async function sendInviteEmail(user: { id: number; email: string; name: string | null }): Promise<void> {
  const token = await createSetPasswordToken(auth, user.id, INVITE_TOKEN_TTL_SECONDS);
  const url = resetPasswordUrl(token);
  const expiresInDays = INVITE_TOKEN_TTL_SECONDS / 86400;
  await emailSender.send({ to: user.email, ...inviteEmail({ name: user.name, url, expiresInDays }) });
}

// role/schoolId are better-auth additionalFields — present at runtime (the helper
// sets them) but absent from the helper's static return type.
type ProvisionedUser = Awaited<ReturnType<typeof createUserWithCredential>>;

function provisionedToRow(u: ProvisionedUser): UserRow {
  const withFields = u as ProvisionedUser & { role: UserRole; schoolId: number | null };
  return {
    id: withFields.id,
    email: withFields.email,
    name: withFields.name,
    role: withFields.role,
    schoolId: withFields.schoolId,
    createdAt: withFields.createdAt,
  };
}

const BULK_CONCURRENCY = 8;

// createUserWithCredential translates a racing insert's Prisma P2002 into
// EmailInUseError internally, but keep the raw P2002 check here too as a
// defense-in-depth backstop in case that translation is ever bypassed.
function isDuplicateEmailError(err: unknown): boolean {
  return err instanceof EmailInUseError || isPrismaError(err, "P2002");
}

// GET /me — must come before /:id
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const { id, email, name, role, schoolId, createdAt } = req.user!;
  const school = schoolId
    ? await prisma.school.findFirst({
        where: { id: schoolId, deletedAt: null },
        select: { id: true, name: true, timezone: true },
      })
    : null;
  res.json({ ...toUserResponse({ id, email, name, role, schoolId, createdAt }), school } satisfies MeResponse);
});

// GET / — cursor-paginated list; ?ids= replaces the former /batch endpoint
router.get(
  "/",
  requireAuth,
  requireRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateQuery(listUsersSchema),
  async (req: Request, res: Response) => {
    const { role, cursor, ids, limit, q } = req.query as unknown as {
      role?: string;
      cursor?: string;
      ids?: string;
      limit: number;
      q?: string;
    };
    const take = limit;

    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;

    if (!isSuperAdmin && req.user!.schoolId === null) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    if (ids) {
      // Explicit id lookup — role/q are intentionally not applied here; the
      // caller is asking for these specific IDs regardless of other filters.
      const rawIds = ids.split(",").map((id) => id.trim()).filter(Boolean);
      if (rawIds.length > 100) {
        res.status(400).json({ message: "Too many IDs (max 100)" });
        return;
      }
      const idList = rawIds.map(Number);
      if (idList.some((id) => !Number.isInteger(id) || id <= 0)) {
        res.status(400).json({ message: "Invalid ID format" });
        return;
      }
      const where: Record<string, unknown> = { id: { in: idList }, deletedAt: null };
      if (!isSuperAdmin) where.schoolId = req.user!.schoolId;
      const users = await prisma.user.findMany({ where, select: USER_SELECT });
      res.json({ data: users.map(toUserResponse), nextCursor: null } satisfies CursorPage<UserResponse>);
      return;
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (!isSuperAdmin) where.schoolId = req.user!.schoolId;
    if (role) where.role = role;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: USER_SELECT,
    });

    const { data, nextCursor } = paginate(users, take);

    res.json({ data: data.map(toUserResponse), nextCursor } satisfies CursorPage<UserResponse>);
  },
);

router.get(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireSelfOrRole(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const userId = Number(req.params.id);
    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;
    const isSelf = userId === req.user!.id;

    if (!isSuperAdmin && !isSelf && req.user!.schoolId === null) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const where: Record<string, unknown> = { id: userId, deletedAt: null };
    if (!isSuperAdmin && !isSelf) where.schoolId = req.user!.schoolId;

    // pinCode is only for the ADMIN+ voice-lookup workflow — never for
    // TEACHER or a user viewing their own record.
    const canViewPin = !isSelf && (isSuperAdmin || req.user!.role === UserRole.ADMIN);
    const user = await prisma.user.findFirst({
      where,
      select: canViewPin ? USER_SELECT_WITH_PIN : USER_SELECT,
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
    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;
    const targetRole: UserRole = req.body.role ?? UserRole.STUDENT;
    // `>` not `>=`: an ADMIN may create peer ADMINs. Only PATCH/DELETE on an
    // existing peer account is blocked — creation is intentionally looser.
    if (roleRank(targetRole) > roleRank(req.user!.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const tempPassword = generateTempPassword();

    try {
      const user = await createUserWithCredential(auth, {
        email: req.body.email,
        name: req.body.name,
        password: tempPassword,
        role: targetRole,
        ...(isSuperAdmin ? {} : { schoolId: req.user!.schoolId }),
      });
      try {
        await assignPin(user.id, targetRole);
      } catch (pinErr: unknown) {
        // The user row is already committed here; a pin failure (transient DB
        // error, or exhausting MAX_PIN_ATTEMPTS) must not turn an
        // already-created account into an unrecoverable 500 behind the
        // duplicate-email guard below — log and continue without a pin.
        logger.error(pinErr, `[users] failed to assign pinCode to user ${user.id}`);
      }
      try {
        await sendInviteEmail(user);
      } catch (emailErr: unknown) {
        // Same reasoning as the pin catch above — the account already exists
        // and tempPassword is still returned below, so email delivery never
        // blocks provisioning.
        logger.error(emailErr, `[users] failed to send invite email to user ${user.id}`);
      }
      res.status(201).json({ ...toUserResponse(provisionedToRow(user)), tempPassword } satisfies ProvisionUserResponse);
    } catch (err: unknown) {
      if (isDuplicateEmailError(err)) {
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

    // `>` not `>=`: same intentional peer-creation allowance as POST /.
    for (const u of users) {
      if (roleRank(u.role ?? "STUDENT") > callerRank) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }

    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;
    const results: PromiseSettledResult<unknown>[] = new Array(users.length);

    // scrypt hashing is deliberately slow — throttle to a small pool rather than
    // firing every provisioning call at once.
    for (let start = 0; start < users.length; start += BULK_CONCURRENCY) {
      const batch = users.slice(start, start + BULK_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (u) => {
          const role = u.role ?? UserRole.STUDENT;
          const user = await createUserWithCredential(auth, {
            email: u.email,
            name: u.name,
            password: generateTempPassword(),
            role,
            ...(isSuperAdmin ? {} : { schoolId: req.user!.schoolId }),
          });
          try {
            await assignPin(user.id, role);
          } catch (pinErr: unknown) {
            // Same non-fatal handling as the single-create path: the user is
            // already committed, so a pin failure must not report an
            // otherwise-successful creation as a failed PromiseSettledResult.
            logger.error(pinErr, `[users] failed to assign pinCode to user ${user.id}`);
          }
          try {
            await sendInviteEmail(user);
          } catch (emailErr: unknown) {
            // Same non-fatal handling as the pin catch above.
            logger.error(emailErr, `[users] failed to send invite email to user ${user.id}`);
          }
          return user;
        }),
      );
      for (let i = 0; i < settled.length; i += 1) results[start + i] = settled[i];
    }

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .map((r, i) => ({ result: r, index: i }))
      .filter(({ result }) => result.status === "rejected")
      .map(({ result, index }) => ({
        index,
        email: users[index].email,
        error: isDuplicateEmailError((result as PromiseRejectedResult).reason)
          ? "Email already in use"
          : "Failed to create user",
      }));

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
    const userId = Number(req.params.id);
    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;
    const isSelf = userId === req.user!.id;

    if (!isSuperAdmin && !isSelf && req.user!.schoolId === null) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if ("schoolId" in req.body && !isSuperAdmin) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const findWhere: Record<string, unknown> = { id: userId, deletedAt: null };
    if (!isSuperAdmin && !isSelf) findWhere.schoolId = req.user!.schoolId;

    const user = await prisma.user.findFirst({ where: findWhere });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (!isSelf && roleRank(user.role as UserRole) >= roleRank(req.user!.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    if (req.body.email && roleRank(req.user!.role) < roleRank(UserRole.ADMIN)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    // `>` not `>=`: an ADMIN may promote another user up to their own rank,
    // same intentional allowance as POST / — see comment there.
    if (req.body.role && roleRank(req.body.role) > roleRank(req.user!.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: req.body,
        select: USER_SELECT,
      });
      res.json(toUserResponse(updated));
    } catch (err: unknown) {
      if (isPrismaError(err, "P2003")) {
        res.status(400).json({ message: "Invalid schoolId" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const userId = Number(req.params.id);
    const isSuperAdmin = req.user!.role === UserRole.SUPER_ADMIN;

    if (!isSuperAdmin && req.user!.schoolId === null) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const findWhere: Record<string, unknown> = { id: userId, deletedAt: null };
    if (!isSuperAdmin) findWhere.schoolId = req.user!.schoolId;
    const user = await prisma.user.findFirst({
      where: findWhere,
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
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    // The soft-delete above doesn't touch better-auth's Session rows — without
    // this, a deleted user's existing session keeps working against
    // /api/auth/* (see tech-debt.md §2).
    try {
      await prisma.session.deleteMany({ where: { userId } });
    } catch (sessionErr: unknown) {
      // Same reasoning as the pin/email catches above — the soft-delete is
      // already committed, so a session-cleanup failure must not turn an
      // otherwise-successful deletion into a 500.
      logger.error(sessionErr, `[users] failed to revoke sessions for deleted user ${userId}`);
    }

    res.status(204).send();
  },
);

export default router;
