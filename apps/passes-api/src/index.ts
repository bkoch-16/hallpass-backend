import "dotenv/config";
import http from "node:http";
import { env } from "./env";
import app from "./app";
import { initSocket } from "./lib/socket.js";
import { startExpiryWorker } from "./lib/queue.js";

const PORT = env.PORT ?? 3003;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

const httpServer = http.createServer(app);
initSocket(httpServer);
httpServer.listen(PORT, () => {
  console.log(`passes-api listening on port ${PORT}`);
  startExpiryWorker();
});
