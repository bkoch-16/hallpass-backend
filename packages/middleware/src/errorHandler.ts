import { Request, Response, NextFunction } from "express";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ message: "Not found" });
}

interface ErrorLogger {
  error: (err: unknown, msg?: string) => void;
  warn: (err: unknown, msg?: string) => void;
}

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  expose?: boolean;
}

export function createErrorHandler(logger: ErrorLogger) {
  return (err: HttpError, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      logger.error(err, "Unhandled route error");
      next(err);
      return;
    }
    // http-errors contract (used by body-parser etc.): expose=true marks a
    // client error whose message is safe to return. statusCode alone is not
    // trusted — arbitrary thrown errors can carry status-like fields.
    const statusCode = err.statusCode ?? err.status;
    if (err.expose === true && statusCode && statusCode >= 400 && statusCode < 500) {
      logger.warn(err, "Client request error");
      res.status(statusCode).json({ message: err.message });
      return;
    }
    logger.error(err, "Unhandled route error");
    res.status(500).json({ message: "Internal server error" });
  };
}
