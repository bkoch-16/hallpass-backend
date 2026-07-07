import { describe, it, expect } from "vitest";
import { parseCorsOrigins } from "../src/cors";

/**
 * Pins the exact semantics of apps/passes-api/src/lib/cors.ts:
 *
 *   env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((o) => o.trim())
 *
 * i.e. a literal "*" passes through as the string "*" (cors's allow-all), and
 * anything else is comma-split into a trimmed array of origins.
 */
describe("parseCorsOrigins", () => {
  it('returns the literal string "*" for a wildcard CORS_ORIGIN', () => {
    expect(parseCorsOrigins({ CORS_ORIGIN: "*" })).toBe("*");
  });

  it("returns a single-element array for one origin", () => {
    expect(parseCorsOrigins({ CORS_ORIGIN: "http://localhost:5173" })).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("splits a comma-separated list into an array", () => {
    expect(
      parseCorsOrigins({ CORS_ORIGIN: "http://localhost:5173,https://app.example.com" }),
    ).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  it("trims whitespace around each origin", () => {
    expect(
      parseCorsOrigins({ CORS_ORIGIN: " http://localhost:5173 , https://app.example.com " }),
    ).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  it('does not treat "*" embedded in a list as a wildcard', () => {
    expect(parseCorsOrigins({ CORS_ORIGIN: "*,http://localhost:5173" })).toEqual([
      "*",
      "http://localhost:5173",
    ]);
  });

  it("returns [\"\"] for an empty string, mirroring the source exactly", () => {
    // baseEnvSchema requires CORS_ORIGIN to be non-empty, so this cannot occur
    // for a validated env; pinned only to keep parity with the original file.
    expect(parseCorsOrigins({ CORS_ORIGIN: "" })).toEqual([""]);
  });

  it("throws when CORS_ORIGIN is undefined (requires a validated env)", () => {
    // The original reads env.CORS_ORIGIN.split(...) with no undefined guard;
    // callers must pass an env already validated by baseEnvSchema.
    expect(() =>
      parseCorsOrigins({ CORS_ORIGIN: undefined as unknown as string }),
    ).toThrow();
  });
});
