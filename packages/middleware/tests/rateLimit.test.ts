import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";
import { createGeneralLimiter, createAuthLimiter } from "../src/rateLimit";

type LimiterOptions = Parameters<typeof createGeneralLimiter>[0];

/**
 * Builds an app that authenticates via the `x-user-id` header (simulating
 * the apps' session middleware populating req.user) and then applies the
 * general limiter. Requests without the header are unauthenticated.
 */
function generalApp(options?: LimiterOptions) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const id = req.header("x-user-id");
    if (id) {
      req.user = { id: Number(id) } as NonNullable<Request["user"]>;
    }
    next();
  });
  app.use(createGeneralLimiter(options));
  app.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

/**
 * Mirrors user-api wiring: express.json() runs before the auth limiter, so
 * the limiter can key off req.body.email.
 */
function authApp(options?: LimiterOptions) {
  const app = express();
  app.use(express.json());
  app.use(createAuthLimiter(options));
  app.post("/login", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function stubStore(totalHits = 1) {
  return {
    init: vi.fn(),
    increment: vi.fn(async (_key: string) => ({
      totalHits,
      resetTime: new Date(Date.now() + 60_000),
    })),
    decrement: vi.fn(),
    resetKey: vi.fn(),
  };
}

function erroringStore() {
  return {
    init: vi.fn(),
    increment: vi.fn(async (_key: string) => {
      throw new Error("store unavailable");
    }),
    decrement: vi.fn(),
    resetKey: vi.fn(),
  };
}

describe("createGeneralLimiter", () => {
  it("returns 429 with the pinned body and draft-8 headers once max is exceeded", async () => {
    const app = generalApp({ limit: 2 });

    const first = await request(app).get("/");
    expect(first.status).toBe(200);
    // standardHeaders: "draft-8" — RateLimit / RateLimit-Policy, no legacy X-RateLimit-*
    expect(first.headers["ratelimit"]).toBeDefined();
    expect(first.headers["ratelimit-policy"]).toBeDefined();
    expect(first.headers["x-ratelimit-limit"]).toBeUndefined();

    await request(app).get("/");
    const limited = await request(app).get("/");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many requests" });
    expect(limited.headers["ratelimit"]).toBeDefined();
    expect(limited.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("isolates counters per authenticated user behind the same IP", async () => {
    const app = generalApp({ limit: 2 });

    // User 1 exhausts their own quota
    expect((await request(app).get("/").set("x-user-id", "1")).status).toBe(200);
    expect((await request(app).get("/").set("x-user-id", "1")).status).toBe(200);
    expect((await request(app).get("/").set("x-user-id", "1")).status).toBe(429);

    // User 2 shares the IP but has an independent counter
    expect((await request(app).get("/").set("x-user-id", "2")).status).toBe(200);
  });

  it("falls back to IP keying for unauthenticated requests, independent of user keys", async () => {
    const app = generalApp({ limit: 1 });

    // Unauthenticated requests share the IP-keyed counter
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);

    // An authenticated user from the exhausted IP is unaffected
    expect((await request(app).get("/").set("x-user-id", "7")).status).toBe(200);
  });

  it("defaults to 100 requests per 15-minute window outside test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = generalApp();
    vi.unstubAllEnvs();

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      // Pins the app defaults: limit 100 (q=100), windowMs 15 * 60 * 1000 (w=900s)
      expect(res.headers["ratelimit-policy"]).toMatch(/q=100;\s*w=900/);
    }

    const limited = await request(app).get("/");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many requests" });
  });

  it('defaults to an effectively unlimited limit under NODE_ENV === "test"', async () => {
    const app = generalApp();

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    // Pins the test-env default: limit Number.MAX_SAFE_INTEGER (q=9007199254740991)
    expect(res.headers["ratelimit-policy"]).toMatch(
      new RegExp(`q=${Number.MAX_SAFE_INTEGER};\\s*w=900`),
    );
  });

  it("honors a windowMs override", async () => {
    const app = generalApp({ limit: 1, windowMs: 200 });

    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);

    // Wait past the (short) window so the counter resets
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((await request(app).get("/")).status).toBe(200);
  });

  it("uses a custom store when provided", async () => {
    const store = stubStore(1);
    const app = generalApp({ store } as LimiterOptions);

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(store.increment).toHaveBeenCalledTimes(1);
    expect(store.increment).toHaveBeenCalledWith(expect.any(String));
  });

  it("lets the custom store's totalHits drive the 429 decision", async () => {
    const store = stubStore(1_000);
    const app = generalApp({ store, limit: 100 } as LimiterOptions);

    const res = await request(app).get("/");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: "Too many requests" });
  });

  it("fails open (200) when the store errors and passOnStoreError is true", async () => {
    const store = erroringStore();
    const app = generalApp({ store, passOnStoreError: true } as LimiterOptions);

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(store.increment).toHaveBeenCalledTimes(1);
  });

  it("stays fail-closed (500) on store errors when passOnStoreError is not set", async () => {
    const store = erroringStore();
    const app = generalApp({ store } as LimiterOptions);

    const res = await request(app).get("/");

    expect(res.status).toBe(500);
  });
});

describe("createAuthLimiter", () => {
  it("keys by normalized (lowercased/trimmed) req.body.email", async () => {
    const app = authApp({ limit: 1 });

    const first = await request(app)
      .post("/login")
      .send({ email: "  User@Example.com " });
    expect(first.status).toBe(200);

    // Same email after normalization — shares the counter
    const second = await request(app)
      .post("/login")
      .send({ email: "user@example.com" });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ message: "Too many requests" });
  });

  it("gives different emails independent counters behind the same IP", async () => {
    const app = authApp({ limit: 1 });

    expect(
      (await request(app).post("/login").send({ email: "a@example.com" })).status,
    ).toBe(200);
    expect(
      (await request(app).post("/login").send({ email: "a@example.com" })).status,
    ).toBe(429);
    expect(
      (await request(app).post("/login").send({ email: "b@example.com" })).status,
    ).toBe(200);
  });

  it("falls back to IP keying when email is absent", async () => {
    const app = authApp({ limit: 1 });

    expect((await request(app).post("/login").send({})).status).toBe(200);
    expect((await request(app).post("/login").send({})).status).toBe(429);

    // Email-keyed request from the exhausted IP is unaffected
    expect(
      (await request(app).post("/login").send({ email: "c@example.com" })).status,
    ).toBe(200);
  });

  it("defaults to 10 requests per 15-minute window with the pinned 429 response", async () => {
    const app = authApp();

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/login").send({ email: "d@example.com" });
      expect(res.status).toBe(200);
      // Pins the app defaults: limit 10 (q=10), windowMs 15 * 60 * 1000 (w=900s)
      expect(res.headers["ratelimit-policy"]).toMatch(/q=10;\s*w=900/);
    }

    const limited = await request(app)
      .post("/login")
      .send({ email: "d@example.com" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many requests" });
    expect(limited.headers["ratelimit"]).toBeDefined();
    expect(limited.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("uses a custom store when provided", async () => {
    const store = stubStore(1);
    const app = authApp({ store } as LimiterOptions);

    const res = await request(app).post("/login").send({ email: "e@example.com" });

    expect(res.status).toBe(200);
    expect(store.increment).toHaveBeenCalledTimes(1);
  });

  it("fails open (200) when the store errors and passOnStoreError is true", async () => {
    const store = erroringStore();
    const app = authApp({ store, passOnStoreError: true } as LimiterOptions);

    const res = await request(app).post("/login").send({ email: "f@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(store.increment).toHaveBeenCalledTimes(1);
  });
});
