import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger, httpLogger } from "@hallpass/logger";
import {
  createHealthRoute,
  notFound,
  createErrorHandler,
  createGeneralLimiter,
  parseCorsOrigins,
} from "@hallpass/express-middleware";
import { env } from "./env.js";
import districtRouter from "./routes/district.js";
import schoolRouter from "./routes/school.js";
import scheduleTypeRouter from "./routes/scheduleType.js";
import periodRouter from "./routes/period.js";
import calendarRouter from "./routes/calendar.js";
import destinationRouter from "./routes/destination.js";
import policyRouter from "./routes/policy.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const corsOrigins = parseCorsOrigins(env);
app.use(
  cors({
    origin: corsOrigins,
    credentials: corsOrigins !== "*",
  }),
);
app.options("/*splat", cors({ origin: corsOrigins, credentials: corsOrigins !== "*" }));

app.use(httpLogger);
app.use(express.json());

// Registered before the rate limiter so LB/uptime probes are never 429'd
app.get("/health", createHealthRoute("schools-api"));

const limiter = createGeneralLimiter();

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

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
