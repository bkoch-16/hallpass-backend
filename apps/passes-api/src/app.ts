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
import passesRouter from "./routes/passes.js";
import internalRouter from "./routes/internal.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const corsOrigins = parseCorsOrigins(env);
app.use(
  cors({
    origin: corsOrigins,
    credentials: env.CORS_ORIGIN !== "*",
  }),
);

app.use(httpLogger);
app.use(express.json());

// Registered before the rate limiter so LB/uptime probes are never 429'd
app.get("/health", createHealthRoute("passes-api"));

const limiter = createGeneralLimiter();

app.use(limiter);

app.use("/api/passes", passesRouter);
app.use("/internal", internalRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
