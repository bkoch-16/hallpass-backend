/**
 * Parse CORS_ORIGIN from a validated env: a literal "*" passes through as
 * the string "*" (cors's allow-all), and anything else is comma-split into
 * a trimmed array of origins.
 */
export function parseCorsOrigins(env: {
  CORS_ORIGIN: string;
}): string | string[] {
  return env.CORS_ORIGIN === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((o) => o.trim());
}
