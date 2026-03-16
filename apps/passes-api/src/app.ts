import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger, httpLogger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";
import { env } from "./env";
import passesRouter from "./routes/passes";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const corsOrigins =
  env.CORS_ORIGIN === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: corsOrigins,
    credentials: corsOrigins !== "*",
  }),
);

app.use(httpLogger);
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

app.use(limiter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", service: "passes-api" });
  } catch (err) {
    logger.error(err, "Health check failed");
    res.status(503).json({ status: "error", service: "passes-api" });
  }
});

app.use("/api/passes", passesRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error(err);
    res.status(500).json({ message: "Internal server error" });
  },
);

export default app;
