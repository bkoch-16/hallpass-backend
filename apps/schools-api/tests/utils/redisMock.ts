import { vi } from "vitest";

/**
 * The public GET routes (calendar, schedule-types) run behind
 * publicSchoolDataLimiter, whose RedisStore (rate-limit-redis) sends raw
 * commands via redis.call. Fakes the ioredis client so route/integration
 * tests don't depend on a live Redis (CI has none); an unmocked call
 * rejects and the limiter fails closed with a 500. See
 * publicSchoolDataLimiter.test.ts.
 */
export function createMockRedisCall() {
  return vi.fn((command: string) => {
    if (command === "SCRIPT") return Promise.resolve("fakesha");
    if (command === "EVALSHA") return Promise.resolve([1, 15 * 60 * 1000]);
    return Promise.resolve(undefined);
  });
}
