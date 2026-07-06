import { Request, Response, NextFunction } from "express";
import type { UserRole } from "@hallpass/types";

/**
 * Rank decision: SERVICE (4) ranks above SUPER_ADMIN (3), so
 * requireMinRole(X) admits SERVICE for every X, while requireRole is an
 * exact-match allowlist and admits only the roles listed explicitly.
 */
const ROLE_RANK: Record<UserRole, number> = {
  STUDENT: 0,
  TEACHER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
  SERVICE: 4,
};

export function roleRank(role: UserRole): number {
  return ROLE_RANK[role];
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const hasRole = roles.includes(req.user.role);

    if (!hasRole) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}

/**
 * Allows the request when the authenticated user is the target resource owner
 * or holds one of the given roles. Reads `req.params.id` for the self check,
 * so it is unsafe on routes without an `:id` param (isSelf can never match).
 */
export function requireSelfOrRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const isSelf = Number(req.params.id) === req.user.id;
    const hasRole = roles.includes(req.user.role);

    if (!isSelf && !hasRole) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}

export function requireMinRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (roleRank(req.user.role) < roleRank(minRole)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}
