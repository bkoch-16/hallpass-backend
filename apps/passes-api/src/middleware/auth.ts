import { Request, Response, NextFunction } from "express";
import { resolveSessionUser } from "../lib/sessionUser.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = await resolveSessionUser(req.headers);

  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
}
