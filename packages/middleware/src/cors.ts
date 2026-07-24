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

/**
 * Build the cors options object shared by all three APIs. `origin` comes from
 * parseCorsOrigins; `credentials` is enabled unless CORS_ORIGIN is the literal
 * wildcard "*" (cors forbids credentials with a "*" origin).
 */
export function corsOptions(env: { CORS_ORIGIN: string }): {
  origin: string | string[];
  credentials: boolean;
} {
  return {
    origin: parseCorsOrigins(env),
    credentials: env.CORS_ORIGIN !== "*",
  };
}

/**
 * Trusted origins for better-auth's CSRF-origin check: undefined when
 * CORS_ORIGIN is the wildcard "*" (better-auth's trustedOrigins only accepts
 * a concrete list, never a wildcard), else the same parsed list corsOptions()
 * uses.
 */
export function resolveTrustedOrigins(env: {
  CORS_ORIGIN: string;
}): string[] | undefined {
  return env.CORS_ORIGIN === "*" ? undefined : (parseCorsOrigins(env) as string[]);
}
