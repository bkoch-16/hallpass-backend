import { Request, Response, NextFunction } from "express";
import { Role } from "@hallpass/db";

const ROLE_RANK: Record<Role, number> = {
  [Role.STUDENT]: 0,
  [Role.TEACHER]: 1,
  [Role.ADMIN]: 2,
  [Role.SUPER_ADMIN]: 3,
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

export function requireRole(...roles: Role[]) {
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

export function requireSelfOrRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const isSelf = req.params.id === req.user.id;
    const hasRole = roles.includes(req.user.role);

    if (!isSelf && !hasRole) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}
