import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { httpLogger } from "@hallpass/logger";
import { createHealthRoute } from "./health.js";
import { corsOptions } from "./cors.js";

/**
 * Builds the head of the request pipeline shared byte-for-byte across all
 * three services: trust proxy -> helmet -> cors -> httpLogger -> json ->
 * health. Rate limiting, routes, and the notFound/errorHandler tail differ
 * per service and stay in each app.ts.
 */
export function createBaseApp(serviceName: string, env: { CORS_ORIGIN: string }): Express {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(cors(corsOptions(env)));
  app.options("/*splat", cors(corsOptions(env)));

  app.use(httpLogger);
  app.use(express.json());

  // Registered before the rate limiter so LB/uptime probes are never 429'd
  app.get("/health", createHealthRoute(serviceName));

  return app;
}
