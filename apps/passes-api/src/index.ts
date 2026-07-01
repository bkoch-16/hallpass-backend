import "dotenv/config";
import http from "node:http";
import { logger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";
import { env } from "./env.js";
import app from "./app.js";
import { initSocket } from "./lib/socket.js";
import { redis } from "./lib/redis.js";
import { startExpiryWorker, closeQueue } from "./lib/queue.js";

const PORT = env.PORT;

process.on("unhandledRejection", (reason) => {
  logger.error(reason, "Unhandled Rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught Exception");
  process.exit(1);
});

const httpServer = http.createServer(app);
const { pubClient, subClient } = initSocket(httpServer);
const expiryWorker = startExpiryWorker();

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down");
  // Safety net: don't let a hung close outlive the Cloud Run grace period
  setTimeout(() => process.exit(1), 10_000).unref();

  httpServer.close(() => logger.info("HTTP server closed"));
  try {
    await expiryWorker.close();
  } catch (err) {
    logger.error(err, "Error closing expiry worker");
  }
  await closeQueue();
  await prisma.$disconnect();
  redis.disconnect();
  pubClient.disconnect();
  subClient.disconnect();
  logger.info("Shutdown complete");
});

httpServer.listen(PORT, () => {
  logger.info(`passes-api listening on port ${PORT}`);
});
