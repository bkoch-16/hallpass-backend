import pino from "pino";
import pinoHttp from "pino-http";

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
});

export const httpLogger = pinoHttp({ logger });
