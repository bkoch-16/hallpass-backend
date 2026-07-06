import { Request, Response, NextFunction } from "express";

export function requireSchool(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.schoolId) {
    res.status(422).json({ message: "User is not associated with a school" });
    return;
  }
  next();
}
