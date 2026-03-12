import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger, httpLogger } from "@hallpass/logger";
import { prisma } from "@hallpass/db";
import { env } from "./env";
import districtRouter from "./routes/district";
import schoolRouter from "./routes/school";
import scheduleTypeRouter from "./routes/scheduleType";
import periodRouter from "./routes/period";
import calendarRouter from "./routes/calendar";
import destinationRouter from "./routes/destination";
import policyRouter from "./routes/policy";

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

// Nested sub-resource routers must be mounted on the school router
// with mergeParams so they can access :schoolId
scheduleTypeRouter.use("/:scheduleTypeId/periods", periodRouter);

schoolRouter.use("/:schoolId/schedule-types", scheduleTypeRouter);
schoolRouter.use("/:schoolId/calendar", calendarRouter);
schoolRouter.use("/:schoolId/destinations", destinationRouter);
schoolRouter.use("/:schoolId/policy", policyRouter);

app.use("/api/districts", districtRouter);
app.use("/api/schools", schoolRouter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", service: "schools-api" });
  } catch (err) {
    logger.error(err, "Health check failed");
    res.status(503).json({ status: "error", service: "schools-api" });
  }
});

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
