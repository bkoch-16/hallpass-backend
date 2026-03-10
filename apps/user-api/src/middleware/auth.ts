import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "@hallpass/auth";
import { auth } from "../auth";
import { prisma } from "@hallpass/db";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let session;
  try {
    session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (!session) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
}
