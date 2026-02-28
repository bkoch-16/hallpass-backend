import { Request, Response, NextFunction } from "express";
import { auth, fromNodeHeaders } from "@hallpass/auth";
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
}
