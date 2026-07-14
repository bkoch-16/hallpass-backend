import { describe, it, expect, vi } from "vitest";
import type Redis from "ioredis";
import { createRedisRateLimitStore } from "../src/redis";

describe("createRedisRateLimitStore", () => {
  it("does not raise an unhandled rejection when the initial SCRIPT LOAD fails before any request awaits it", async () => {
    // Mirrors what happens when a limiter is built at module load (before any
    // request hits it) against a Redis that's briefly unreachable: RedisStore's
    // constructor fires SCRIPT LOAD immediately and nothing awaits it yet.
    const redis = {
      call: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as Redis;

    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);

    createRedisRateLimitStore(redis, "rl:test:");

    // Give Node's unhandled-rejection check a chance to run against the
    // constructor's fire-and-forget SCRIPT LOAD promises.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    process.off("unhandledRejection", onUnhandledRejection);
    expect(onUnhandledRejection).not.toHaveBeenCalled();
  });
});
