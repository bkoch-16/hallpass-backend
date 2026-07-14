import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRedisStore } = vi.hoisted(() => ({
  mockRedisStore: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

// createRedisRateLimitStore (packages/middleware/src/redis.ts) constructs a
// `RedisStore` from the `rate-limit-redis` npm package. Mocking that package
// directly — rather than the `@hallpass/express-middleware` barrel's
// `createRedisRateLimitStore` export — intercepts store construction
// regardless of which internal module calls `new RedisStore(...)`: both the
// general limiter (app.ts calls createRedisRateLimitStore directly) and the
// public-school-data limiter (routed through createIpRateLimiter's own
// relative `./redis.js` import, which bypasses a mock of the package barrel).
vi.mock("rate-limit-redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("rate-limit-redis")>();
  return {
    ...actual,
    RedisStore: vi.fn().mockImplementation(function (options: { prefix: string; sendCommand: unknown }) {
      mockRedisStore(options);
      return {
        init: vi.fn(),
        get: vi.fn(),
        increment: vi.fn(),
        decrement: vi.fn(),
        resetKey: vi.fn(),
        incrementScriptSha: Promise.resolve(),
        getScriptSha: Promise.resolve(),
      };
    }),
  };
});

vi.mock("ioredis", () => ({
  default: class {
    on = vi.fn();
    call = vi.fn();
  },
}));

vi.mock("@hallpass/db", () => ({
  prisma: {},
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: vi.fn() },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

describe("app rate-limit store wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRedisStore.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The general limiter's store is conditional on NODE_ENV/REDIS_URL (falls
  // back to in-memory), but the public-school-data limiter (calendar,
  // schedule-types) always constructs a RedisStore regardless of NODE_ENV —
  // it requires Redis unconditionally, same as passes-api's pinLookupLimiter.
  // These assertions scope to the general limiter's prefix so they don't
  // depend on how many other limiters exist in the import graph.
  function generalLimiterCalls() {
    return mockRedisStore.mock.calls.filter(([options]) =>
      (options as { prefix: string }).prefix.includes(":general:"),
    );
  }

  it("keeps the general limiter's in-memory store under NODE_ENV=test (no Redis server needed)", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await import("../src/app.js");

    expect(generalLimiterCalls()).toHaveLength(0);
  });

  it("wires the general limiter's RedisStore namespaced under REDIS_PREFIX outside the test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("REDIS_PREFIX", "test");

    await import("../src/app.js");

    const calls = generalLimiterCalls();
    expect(calls).toHaveLength(1);
    const options = calls[0][0] as { prefix: string; sendCommand: unknown };
    expect(options.prefix).toBe("test:rl:schools-api:general:");
    expect(typeof options.sendCommand).toBe("function");
  });

  it("always wires a RedisStore for the public-school-data limiter, regardless of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await import("../src/app.js");

    const calls = mockRedisStore.mock.calls.filter(([options]) =>
      (options as { prefix: string }).prefix.includes(":public-school-data:"),
    );
    // One RedisStore per route file (calendar.ts, scheduleType.ts) that
    // instantiates the limiter, sharing the same Redis-backed bucket via
    // the identical prefix.
    expect(calls).toHaveLength(2);
    for (const [options] of calls) {
      expect((options as { prefix: string }).prefix).toBe("test:rl:schools-api:public-school-data:");
    }
  });
});
