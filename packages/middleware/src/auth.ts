import type { IncomingHttpHeaders } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { prisma, type User } from "@hallpass/db";
import { constantTimeEquals } from "./apiKey.js";

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

/**
 * Create a middleware that accepts either a valid better-auth session or a
 * static API key, for endpoints exposed both to logged-in users and a
 * trusted external caller (e.g. a voice-AI agent) that has no session.
 * Session takes priority: when present, req.user is set as in requireAuth.
 * When falling back to the API key, req.user is left unset — callers
 * downstream must treat the absence of req.user as "trusted, unscoped
 * caller" rather than "anonymous", since this middleware already rejected
 * anonymous requests with 401.
 */
export function createRequireAuthOrApiKey(
  auth: SessionAuth,
  apiKey: string,
  headerName = "x-api-key",
) {
  return async function requireAuthOrApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const user = await resolveSessionUser(auth, req.headers);
    if (user) {
      req.user = user;
      next();
      return;
    }

    const rawHeader = req.headers[headerName.toLowerCase()];
    const provided = typeof rawHeader === "string" ? rawHeader : "";
    const valid =
      typeof rawHeader === "string" && constantTimeEquals(provided, apiKey);

    if (!valid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    next();
  };
}
