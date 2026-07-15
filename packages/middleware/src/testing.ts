import { createServer, type RequestListener, type Server } from "node:http";

export interface TestServerHandle {
  server: Server;
  /** Register with beforeAll. */
  start: () => Promise<void>;
  /** Register with afterAll. */
  stop: () => Promise<void>;
}

/**
 * One shared server bound explicitly to 127.0.0.1 — supertest's default
 * request(app) spawns a wildcard-bound server per request, whose port a
 * foreign local process can shadow with a specific 127.0.0.1 bind (flaky
 * hangs/ECONNRESET/wrong statuses). Register start with
 * beforeAll and stop with afterAll, and pass the returned server to
 * request(server) at call sites.
 */
export function createTestServer(app: RequestListener): TestServerHandle {
  const server = createServer(app);
  return {
    server,
    start: () =>
      new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Fakes rate-limit-redis's RedisStore SCRIPT LOAD / EVALSHA sequence, sent to
 * ioredis via redis.call: SCRIPT LOAD must resolve to a script sha, and
 * EVALSHA must resolve to [count, ttl] — a count of 1 keeps every request
 * under the limit. Wrap this in vi.fn(fakeRedisRateLimitCall) (or pass it
 * directly to vi.fn(...)) to fake an ioredis client's `call` method in tests
 * for routes that sit behind a Redis-backed rate limiter, so they don't
 * depend on a live Redis.
 */
export function fakeRedisRateLimitCall(command: string): Promise<unknown> {
  if (command === "SCRIPT") return Promise.resolve("fakesha");
  if (command === "EVALSHA") return Promise.resolve([1, 15 * 60 * 1000]);
  return Promise.resolve(undefined);
}
