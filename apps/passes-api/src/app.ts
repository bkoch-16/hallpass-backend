import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger, httpLogger } from "@hallpass/logger";
import {
  createHealthRoute,
  notFound,
  createErrorHandler,
} from "@hallpass/express-middleware";
import { env } from "./env.js";
import { corsOrigins } from "./lib/cors.js";
import passesRouter from "./routes/passes.js";
import internalRouter from "./routes/internal.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

app.use(limiter);

app.use("/api/passes", passesRouter);
app.use("/internal", internalRouter);

app.use(notFound);

app.use(createErrorHandler(logger));

export default app;
