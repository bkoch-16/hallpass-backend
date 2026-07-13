import "dotenv/config";
import { logger } from "@hallpass/logger";
import { env } from "./env.js";
import app from "./app.js";

const PORT = env.PORT ?? 3001;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

app.listen(PORT, () => {
  logger.info(`user-api running on port ${PORT}`);
});
