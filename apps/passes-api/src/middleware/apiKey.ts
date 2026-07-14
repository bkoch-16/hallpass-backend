import { Request, Response, NextFunction } from "express";
import { constantTimeEquals } from "../lib/timingSafeCompare.js";

export function createRequireApiKey(expectedKey: string, headerName = "x-api-key") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawHeader = req.headers[headerName.toLowerCase()];
    const provided = typeof rawHeader === "string" ? rawHeader : "";
    const valid =
      typeof rawHeader === "string" &&
      constantTimeEquals(provided, expectedKey);
    if (!valid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  };
}
