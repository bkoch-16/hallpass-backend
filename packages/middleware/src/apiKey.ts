import { timingSafeEqual, createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";

export function constantTimeEquals(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

export function matchesApiKeyHeader(
  req: Request,
  headerName: string,
  expectedKey: string,
): boolean {
  const rawHeader = req.headers[headerName.toLowerCase()];
  const provided = typeof rawHeader === "string" ? rawHeader : "";
  return typeof rawHeader === "string" && constantTimeEquals(provided, expectedKey);
}

export function createRequireApiKey(
  expectedKey: string,
  headerName = "x-api-key",
  prefix = "",
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = `${prefix}${expectedKey}`;
    const valid = matchesApiKeyHeader(req, headerName, expected);
    if (!valid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  };
}
