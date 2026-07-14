import { describe, it, expect } from "vitest";
import { z } from "zod";
import { baseEnvSchema, rateLimitEnvSchema } from "../src/env";

/**
 * Common denominator of the three apps' env schemas (user-api, schools-api,
 * passes-api): DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET and
 * CORS_ORIGIN are required non-empty strings in all three. PORT is optional
 * everywhere; the base schema coerces it to a number and sets NO default
 * (defaults stay app-specific). App-only fields (e.g. passes-api's
 * REDIS_URL/REDIS_PREFIX/INTERNAL_SECRET) are added via .extend().
 */

const validEnv = {
  DATABASE_URL: "postgresql://localhost:5432/hallpass",
  BETTER_AUTH_URL: "http://localhost:3001",
  BETTER_AUTH_SECRET: "test-secret",
  CORS_ORIGIN: "http://localhost:5173",
};

describe("baseEnvSchema", () => {
  it("parses a valid env with all required fields", () => {
    const result = baseEnvSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it.each(["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "CORS_ORIGIN"])(
    "fails fast when required field %s is missing",
    (field) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[field];
      const result = baseEnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    },
  );

  it.each(["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "CORS_ORIGIN"])(
    "fails fast when required field %s is empty",
    (field) => {
      const result = baseEnvSchema.safeParse({ ...validEnv, [field]: "" });
      expect(result.success).toBe(false);
    },
  );

  it("throws on parse() when required fields are missing", () => {
    expect(() => baseEnvSchema.parse({})).toThrow();
  });

  describe("PORT", () => {
    it('coerces "3000" to the number 3000', () => {
      const result = baseEnvSchema.parse({ ...validEnv, PORT: "3000" });
      expect(result.PORT).toBe(3000);
    });

    it("is optional with no default", () => {
      const result = baseEnvSchema.parse(validEnv);
      expect(result.PORT).toBeUndefined();
    });

    it("rejects a non-numeric value", () => {
      const result = baseEnvSchema.safeParse({ ...validEnv, PORT: "not-a-port" });
      expect(result.success).toBe(false);
    });
  });

  describe(".extend()", () => {
    it("supports app-specific required fields on top of the base schema", () => {
      const extended = baseEnvSchema.extend({
        REDIS_PREFIX: z.string().min(1),
      });

      expect(extended.safeParse(validEnv).success).toBe(false);

      const result = extended.parse({ ...validEnv, REDIS_PREFIX: "local" });
      expect(result.REDIS_PREFIX).toBe("local");
    });

    it("still enforces base required fields on the extended schema", () => {
      const extended = baseEnvSchema.extend({
        INTERNAL_SECRET: z.string().min(1),
      });

      const result = extended.safeParse({ INTERNAL_SECRET: "shh" });
      expect(result.success).toBe(false);
    });
  });
});

describe("rateLimitEnvSchema", () => {
  it("accepts env without REDIS_URL (in-memory fallback)", () => {
    expect(rateLimitEnvSchema.safeParse(validEnv).success).toBe(true);
  });

  it("requires REDIS_PREFIX when REDIS_URL is set", () => {
    expect(
      rateLimitEnvSchema.safeParse({ ...validEnv, REDIS_URL: "redis://localhost:6379" }).success,
    ).toBe(false);
    expect(
      rateLimitEnvSchema.safeParse({
        ...validEnv,
        REDIS_URL: "redis://localhost:6379",
        REDIS_PREFIX: "local",
      }).success,
    ).toBe(true);
  });
});
