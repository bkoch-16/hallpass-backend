import { Request, Response, NextFunction } from "express";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ message: "Not found" });
}

interface ErrorLogger {
  error: (err: unknown, msg?: string) => void;
}

export function createErrorHandler(logger: ErrorLogger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, "Unhandled route error");
    res.status(500).json({ message: "Internal server error" });
  };
}
