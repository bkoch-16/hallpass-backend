import { env } from "../env.js";

export const corsOrigins: string | string[] =
  env.CORS_ORIGIN === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((o) => o.trim());
