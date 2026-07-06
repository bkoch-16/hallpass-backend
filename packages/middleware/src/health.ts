import { Request, Response } from "express";
import { logger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";

export function createHealthRoute(serviceName: string) {
  return async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", service: serviceName });
    } catch (err) {
      logger.error(err, "Health check failed");
      res.status(503).json({ status: "error", service: serviceName });
    }
  };
}
