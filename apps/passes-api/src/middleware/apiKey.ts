import { timingSafeEqual, createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";

export function createRequireApiKey(expectedKey: string, headerName = "x-api-key") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawHeader = req.headers[headerName.toLowerCase()];
    const provided = typeof rawHeader === "string" ? rawHeader : "";
    const hash = (s: string) => createHash("sha256").update(s).digest();
    const valid =
      typeof rawHeader === "string" &&
      timingSafeEqual(hash(provided), hash(expectedKey));
    if (!valid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  };
}
