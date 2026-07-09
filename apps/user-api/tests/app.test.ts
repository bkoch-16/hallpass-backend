import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestServer } from "@hallpass/express-middleware";

const { mockGetSession, mockRedisStore } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedisStore: vi.fn(),
}));

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

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: unknown) => new Headers(headers as Record<string, string>)),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
  Role: {
    STUDENT: "STUDENT",
    TEACHER: "TEACHER",
    ADMIN: "ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
  },
}));

import app from "../src/app.js";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
};

const { server, start, stop } = createTestServer(app);

beforeAll(start);
afterAll(stop);

describe("Helmet security headers", () => {
  it("sets X-Content-Type-Options: nosniff on all responses", async () => {
    const res = await request(server).get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options on all responses", async () => {
    const res = await request(server).get("/health");

    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});

describe("CORS headers", () => {
  it("returns Access-Control-Allow-Origin for allowed origin", async () => {
    const res = await request(server).get("/health").set("Origin", "http://localhost:3000");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("does not return Access-Control-Allow-Origin for disallowed origin", async () => {
    const res = await request(server).get("/health").set("Origin", "http://example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Global error handler", () => {
  it("returns 500 with message when an unhandled error propagates from middleware", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(server).get("/api/users/me");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});

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

  it("wires general + auth RedisStores namespaced under REDIS_PREFIX outside the test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("REDIS_PREFIX", "test");

    await import("../src/app.js");

    expect(mockRedisStore).toHaveBeenCalledTimes(2);
    const prefixes = mockRedisStore.mock.calls.map(
      (c) => (c[0] as { prefix: string }).prefix,
    );
    expect(prefixes).toEqual(["test:rl:user-api:general:", "test:rl:user-api:auth:"]);
  });
});
