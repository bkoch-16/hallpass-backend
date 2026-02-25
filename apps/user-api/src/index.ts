import "dotenv/config";
import { env } from "./env";
import app from "./app";

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
  console.log(`user-api running on port ${PORT}`);
});
