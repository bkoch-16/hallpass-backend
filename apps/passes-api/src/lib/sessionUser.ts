import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "@hallpass/auth";
import { prisma, type User } from "@hallpass/db";
import { auth } from "../auth.js";

/**
 * Resolve the better-auth session from request headers to the DB user
 * (the session user carries only better-auth's base fields — the DB row
 * has role/schoolId). Returns null when there is no valid session or the
 * user is missing/soft-deleted; getSession errors propagate to the caller.
 */
export async function resolveSessionUser(
  headers: IncomingHttpHeaders,
): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });
  if (!session?.user) return null;

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });
}
