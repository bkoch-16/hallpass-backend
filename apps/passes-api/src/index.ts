import "dotenv/config";
import http from "node:http";
import { logger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";
import { env } from "./env.js";
import app from "./app.js";
import { initSocket } from "./lib/socket.js";
import { redis } from "./lib/redis.js";
import { clearAllExpiryTimers } from "./lib/expiry.js";

const PORT = env.PORT ?? 3003;

process.on("unhandledRejection", (reason) => {
  logger.error(reason, "Unhandled Rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught Exception");
  process.exit(1);
});

const httpServer = http.createServer(app);
const { io, pubClient, subClient } = initSocket(httpServer);

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down");
  // Safety net: don't let a hung close outlive the Cloud Run grace period
  setTimeout(() => process.exit(1), 10_000).unref();

  // io.close() disconnects Socket.io clients and closes the underlying HTTP
  // server — plain httpServer.close() would wait on open WebSockets forever.
  // Await it so in-flight requests finish before connections are torn down.
  await new Promise<void>((resolve) => io.close(() => resolve()));
  logger.info("HTTP server closed");
  clearAllExpiryTimers();
  await prisma.$disconnect();
  redis.disconnect();
  pubClient.disconnect();
  subClient.disconnect();
  logger.info("Shutdown complete");
});

httpServer.listen(PORT, () => {
  logger.info(`passes-api listening on port ${PORT}`);
});
