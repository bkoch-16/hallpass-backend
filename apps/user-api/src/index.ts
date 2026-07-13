import "dotenv/config";
import { logger } from "@hallpass/logger";
import { env } from "./env.js";
import app from "./app.js";

const PORT = env.PORT ?? 3001;

process.on("unhandledRejection", (reason) => {
  logger.error(reason, "Unhandled Rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught Exception");
  process.exit(1);
});

app.listen(PORT, () => {
  logger.info(`user-api running on port ${PORT}`);
});
