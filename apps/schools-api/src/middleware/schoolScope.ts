import { Request, Response, NextFunction } from "express";
import { UserRole } from "@hallpass/types";

export function requireSchoolAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (req.user.role === UserRole.SUPER_ADMIN) {
    return next();
  }

  if (req.user.schoolId !== Number(req.params.schoolId)) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  next();
}

/**
 * Like requireSchoolAccess, but only enforced for session-authenticated
 * requests. API-key-authenticated requests (req.user unset — see
 * createRequireAuthOrApiKey) are a trusted external caller, not scoped to
 * one school, so they pass through to whichever :schoolId they request.
 */
export function requireSchoolAccessIfSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    next();
    return;
  }
  requireSchoolAccess(req, res, next);
}
