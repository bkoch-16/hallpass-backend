import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { passStatusMock } from "./utils/passStatusMock.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRedisStore } = vi.hoisted(() => ({
  mockRedisStore: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@hallpass/express-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hallpass/express-middleware")>();
  return {
    ...actual,
    createRedisRateLimitStore: (
      redis: { call: (...args: unknown[]) => unknown },
      prefix: string,
    ) => {
      const options = {
        prefix,
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args),
      };
      mockRedisStore(options);
      return {
        init: vi.fn(),
        get: vi.fn(),
        increment: vi.fn(),
        decrement: vi.fn(),
        resetKey: vi.fn(),
      };
    },
  };
});

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: {},
}));

vi.mock("../src/lib/slots.js", () => ({
  claimPassSlots: vi.fn(),
  releasePassSlots: vi.fn(),
  releaseAndPromote: vi.fn(),
  getMaxActivePasses: vi.fn(),
  reconcileSlots: vi.fn(),
  reconcileSchoolSlots: vi.fn(),
  promoteFromQueue: vi.fn(),
}));

vi.mock("../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../src/lib/expiry.js", () => ({
  scheduleLocalExpiry: vi.fn(),
  expirePass: vi.fn().mockResolvedValue(undefined),
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

    const generalStoreCalls = mockRedisStore.mock.calls.filter(
      ([options]) => (options as { prefix: string }).prefix === "test:rl:passes-api:general:",
    );
    expect(generalStoreCalls).toHaveLength(0);
  });

  it("wires a RedisStore namespaced under REDIS_PREFIX outside the test env", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await import("../src/app.js");

    const generalStoreCall = mockRedisStore.mock.calls.find(
      ([options]) => (options as { prefix: string }).prefix === "test:rl:passes-api:general:",
    );
    expect(generalStoreCall).toBeDefined();
    const options = generalStoreCall![0] as { prefix: string; sendCommand: unknown };
    expect(options.prefix).toBe("test:rl:passes-api:general:");
    expect(typeof options.sendCommand).toBe("function");
  });
});
