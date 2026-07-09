import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRedisStore } = vi.hoisted(() => ({
  mockRedisStore: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("rate-limit-redis", () => ({
  RedisStore: class MockRedisStore {
    init = vi.fn();
    get = vi.fn();
    increment = vi.fn();
    decrement = vi.fn();
    resetKey = vi.fn();
    constructor(options: unknown) {
      mockRedisStore(options);
    }
  },
}));

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

  it("keeps the in-memory store under NODE_ENV=test (no Redis server needed)", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await import("../src/app.js");

    expect(mockRedisStore).not.toHaveBeenCalled();
  });

  it("wires a RedisStore namespaced under REDIS_PREFIX outside the test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("REDIS_PREFIX", "test");

    await import("../src/app.js");

    expect(mockRedisStore).toHaveBeenCalledTimes(1);
    const options = mockRedisStore.mock.calls[0][0] as {
      prefix: string;
      sendCommand: unknown;
    };
    expect(options.prefix).toBe("test:rl:schools-api:general:");
    expect(typeof options.sendCommand).toBe("function");
  });
});
