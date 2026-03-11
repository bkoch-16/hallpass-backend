import { Request, Response, NextFunction } from "express";
import { UserRole } from "@hallpass/types";

export function requireSchoolAccess(req: Request, res: Response, next: NextFunction) {
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
