import { Request, Response, NextFunction } from "express";
import { resolveSessionUser } from "../lib/sessionUser.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let user;
  try {
    user = await resolveSessionUser(req.headers);
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
}
