import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createPinLookupLimiter, RedisStore } from "../../src/middleware/pinLookupLimiter.js";
import { redis } from "../../src/lib/redis.js";
import type { Store, ClientRateLimitInfo } from "express-rate-limit";

vi.mock("../../src/lib/redis.js", () => ({
  redis: {
    eval: vi.fn(),
    del: vi.fn(),
  },
}));

// In-memory Store stand-in for these unit tests — the real Redis-backed store
// is exercised by the integration test (real Redis) and by the route tests
// (mocked ioredis client). This isolates limiter *behavior* (counting,
// skipSuccessfulRequests, per-key isolation, fail-closed on store error) from
// the storage backend.
class FakeStore implements Store {
  private hits = new Map<string, number>();
  shouldError = false;

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (this.shouldError) {
      throw new Error("store unavailable");
    }
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    return { totalHits, resetTime: new Date(Date.now() + 1000) };
  }

  async decrement(key: string): Promise<void> {
    const current = (this.hits.get(key) ?? 0) - 1;
    this.hits.set(key, Math.max(current, 0));
  }

  async resetKey(key: string): Promise<void> {
    this.hits.delete(key);
  }
}

function buildApp(store: FakeStore, limit: number) {
  const app = express();
  app.set("trust proxy", 1);
  // Always 404s — simulates the "no matching student" failure path that
  // should burn quota (skipSuccessfulRequests only spares 2xx responses).
  app.get(
    "/lookup",
    createPinLookupLimiter({ limit, store }),
    (_req, res) => {
      res.status(404).json({ message: "Student not found" });
    },
  );
  app.get(
    "/lookup-success",
    createPinLookupLimiter({ limit, store: new FakeStore() }),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ message: "Internal server error" });
    },
  );
  return app;
}

describe("createPinLookupLimiter", () => {
  it("returns 429 after `limit` failed responses from one IP", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 2);

    const first = await request(app).get("/lookup");
    const second = await request(app).get("/lookup");
    const third = await request(app).get("/lookup");

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(third.status).toBe(429);
  });

  it("does not consume quota on a successful response (skipSuccessfulRequests)", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 2);

    // Two successes should not burn the 2-request quota.
    await request(app).get("/lookup-success");
    await request(app).get("/lookup-success");
    await request(app).get("/lookup-success");

    // Failures should still have their own full quota available.
    const first = await request(app).get("/lookup");
    const second = await request(app).get("/lookup");
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
  });

  it("gives two different IPs independent counters", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 1);

    const ipA1 = await request(app).get("/lookup").set("X-Forwarded-For", "1.1.1.1");
    const ipA2 = await request(app).get("/lookup").set("X-Forwarded-For", "1.1.1.1");
    const ipB1 = await request(app).get("/lookup").set("X-Forwarded-For", "2.2.2.2");

    expect(ipA1.status).toBe(404);
    expect(ipA2.status).toBe(429);
    expect(ipB1.status).toBe(404);
  });

  it("fails closed (does not silently pass through) on a store error", async () => {
    const store = new FakeStore();
    store.shouldError = true;
    const app = buildApp(store, 10);

    const res = await request(app).get("/lookup");

    // Default passOnStoreError is false — the store error propagates as an
    // error rather than allowing the request through unrated.
    expect(res.status).toBe(500);
  });

  it("defaults to an effectively unbounded limit under NODE_ENV=test unless overridden", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    const store = new FakeStore();
    const app = express();
    app.get("/lookup", createPinLookupLimiter({ store }), (_req, res) => {
      res.status(404).json({ message: "Student not found" });
    });

    for (let i = 0; i < 50; i++) {
      const res = await request(app).get("/lookup");
      expect(res.status).toBe(404);
    }
  });
});

describe("RedisStore (atomic Redis backing)", () => {
  const evalMock = vi.mocked(redis.eval);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increment does the INCR + conditional PEXPIRE in a single atomic eval, not separate incr+pexpire", async () => {
    // [totalHits, pttl] — the Lua script returns both so no follow-up round trip.
    evalMock.mockResolvedValue([1, 900000] as never);
    const store = new RedisStore();

    const info = await store.increment("1.2.3.4");

    // Exactly one Redis round trip for the whole increment path.
    expect(evalMock).toHaveBeenCalledTimes(1);
    // The atomic script gets the key (numKeys=1) and the window ms as an arg.
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("PEXPIRE"),
      1,
      expect.stringContaining(":rl:passes-api:parent-lookup:1.2.3.4"),
      store.windowMs,
    );
    expect(info.totalHits).toBe(1);
    expect(info.resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  it("decrement deletes-on-zero in a single atomic eval", async () => {
    evalMock.mockResolvedValue(0 as never);
    const store = new RedisStore();

    await store.decrement("1.2.3.4");

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("DEL"),
      1,
      expect.stringContaining(":rl:passes-api:parent-lookup:1.2.3.4"),
    );
  });
});
