import type { IncomingHttpHeaders } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { prisma, type User } from "@hallpass/db";

/**
 * Minimal structural view of a better-auth instance — only what session
 * resolution needs. Typed structurally so this package does not depend on
 * @hallpass/auth (which pulls in better-auth at runtime).
 */
export interface SessionAuth {
  api: {
    getSession(options: {
      headers: Headers;
    }): Promise<{ user: { id: string } } | null>;
  };
}

/**
 * Convert Node request headers to web Headers for better-auth's getSession.
 * Mirrors better-auth's fromNodeHeaders, inlined to avoid a runtime
 * dependency on @hallpass/auth.
 */
function toWebHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.append(key, value);
    }
  }
  return headers;
}

/**
 * Resolve the better-auth session from request headers to the DB user
 * (the session user carries only better-auth's base fields — the DB row
 * has role/schoolId). Returns null when there is no valid session (including
 * getSession failures) or the user is missing/soft-deleted; database errors
 * propagate to the caller.
 */
export async function resolveSessionUser(
  auth: SessionAuth,
  headers: IncomingHttpHeaders,
): Promise<User | null> {
  let session;
  try {
    session = await auth.api.getSession({
      headers: toWebHeaders(headers),
    });
  } catch {
    return null;
  }
  if (!session?.user) return null;

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });
}

/**
 * Create a requireAuth middleware bound to the given better-auth instance.
 * Responds 401 { message: "Unauthorized" } when no valid session user is
 * found; otherwise sets req.user and calls next().
 *
 * DB errors are deliberately not caught here: the middleware is async, and
 * Express 5 forwards rejected promises to the error handler, which turns
 * them into a 500 response.
 */
export function createRequireAuth(auth: SessionAuth) {
  return async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const user = await resolveSessionUser(auth, req.headers);

    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    req.user = user;
    next();
  };
}
