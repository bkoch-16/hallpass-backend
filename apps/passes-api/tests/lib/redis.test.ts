import { describe, it, expect, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRedisCtor } = vi.hoisted(() => ({
  mockRedisCtor: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("ioredis", () => ({
  default: class MockRedis {
    on = vi.fn();
    constructor(...args: unknown[]) {
      mockRedisCtor(...args);
    }
  },
}));

vi.mock("../../src/env.js", () => ({
  env: { REDIS_URL: "redis://localhost:6379", REDIS_PREFIX: "test" },
}));

import { createBlockingRedis } from "../../src/lib/redis.js";

describe("createBlockingRedis", () => {
  it("creates a connection with maxRetriesPerRequest: null for blocking consumers", () => {
    // Importing the module already constructed the shared client — only
    // measure the factory call.
    mockRedisCtor.mockClear();

    createBlockingRedis();

    expect(mockRedisCtor).toHaveBeenCalledTimes(1);
    expect(mockRedisCtor).toHaveBeenCalledWith("redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  });
});
