import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createPublicSchoolDataLimiter } from "../../src/middleware/publicSchoolDataLimiter.js";
import type { Store, ClientRateLimitInfo } from "express-rate-limit";

// In-memory Store stand-in for these unit tests — the real Redis-backed store
// is exercised by the route tests (mocked ioredis client). This isolates
// limiter *behavior* (counting, per-key isolation, fail-closed on store
// error) from the storage backend.
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

function buildApp(store: Store, limit: number) {
  const app = express();
  app.set("trust proxy", 1);
  app.get(
    "/data",
    createPublicSchoolDataLimiter({ limit, store }),
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

describe("createPublicSchoolDataLimiter", () => {
  it("returns 429 after `limit` requests from one IP", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 2);

    const first = await request(app).get("/data");
    const second = await request(app).get("/data");
    const third = await request(app).get("/data");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("counts successful requests toward quota (no skipSuccessfulRequests)", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 1);

    const first = await request(app).get("/data");
    const second = await request(app).get("/data");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it("gives two different IPs independent counters", async () => {
    const store = new FakeStore();
    const app = buildApp(store, 1);

    const ipA1 = await request(app).get("/data").set("X-Forwarded-For", "1.1.1.1");
    const ipA2 = await request(app).get("/data").set("X-Forwarded-For", "1.1.1.1");
    const ipB1 = await request(app).get("/data").set("X-Forwarded-For", "2.2.2.2");

    expect(ipA1.status).toBe(200);
    expect(ipA2.status).toBe(429);
    expect(ipB1.status).toBe(200);
  });

  it("fails closed (does not silently pass through) on a store error", async () => {
    const store = new FakeStore();
    store.shouldError = true;
    const app = buildApp(store, 10);

    const res = await request(app).get("/data");

    // Default passOnStoreError is false — the store error propagates as an
    // error rather than allowing the request through unrated.
    expect(res.status).toBe(500);
  });

  it("defaults to an effectively unbounded limit under NODE_ENV=test unless overridden", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    const store = new FakeStore();
    const app = express();
    app.get("/data", createPublicSchoolDataLimiter({ store }), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    for (let i = 0; i < 50; i++) {
      const res = await request(app).get("/data");
      expect(res.status).toBe(200);
    }
  });
});
