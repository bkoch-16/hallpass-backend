import { timingSafeEqual, createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";

export function constantTimeEquals(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

export function createRequireApiKey(
  expectedKey: string,
  headerName = "x-api-key",
  prefix = "",
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawHeader = req.headers[headerName.toLowerCase()];
    const provided = typeof rawHeader === "string" ? rawHeader : "";
    const expected = `${prefix}${expectedKey}`;
    const valid =
      typeof rawHeader === "string" && constantTimeEquals(provided, expected);
    if (!valid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  };
}
