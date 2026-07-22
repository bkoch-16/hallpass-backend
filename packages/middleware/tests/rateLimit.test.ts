import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import {
  createGeneralLimiter,
  createAuthLimiter,
  createAuthAccountLimiter,
} from "../src/rateLimit";

type LimiterOptions = Parameters<typeof createGeneralLimiter>[0];

/**
 * Builds an app that applies the general limiter directly. The limiter keys by
 * the session token (Authorization: Bearer or a *session_token cookie), so
 * tests drive keying via request headers; requests without either are anonymous
 * and key per-IP.
 */
function generalApp(options?: LimiterOptions) {
  const app = express();
  app.use(createGeneralLimiter(options));
  app.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

/**
 * Mirrors user-api wiring: express.json() runs before the auth limiter, so
 * the limiter can key off req.body.email. trust proxy is enabled so tests can
 * simulate distinct source IPs via X-Forwarded-For (matches user-api, which
 * sets `app.set("trust proxy", 1)`).
 */
function authApp(options?: LimiterOptions) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createAuthLimiter(options));
  app.post("/login", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

/** Same wiring as authApp, but with the pure-email account limiter instead. */
function authAccountApp(options?: LimiterOptions) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createAuthAccountLimiter(options));
  app.post("/login", (req, res) => {
    if (req.body?.fail) {
      res.status(401).json({ ok: false });
      return;
    }
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("isolates counters per session behind the same IP", async () => {
    const app = generalApp({ limit: 2 });

    // Session 1 (Bearer token) exhausts its own quota
    const s1 = "Bearer token-one";
    expect((await request(app).get("/").set("authorization", s1)).status).toBe(200);
    expect((await request(app).get("/").set("authorization", s1)).status).toBe(200);
    expect((await request(app).get("/").set("authorization", s1)).status).toBe(429);

    // Session 2 shares the IP but has an independent counter
    expect(
      (await request(app).get("/").set("authorization", "Bearer token-two")).status,
    ).toBe(200);

    // A session cookie is keyed the same way, independent of the above
    expect(
      (await request(app)
        .get("/")
        .set("cookie", "better-auth.session_token=cookie-token")).status,
    ).toBe(200);
  });

  it("falls back to IP keying for anonymous requests, independent of session keys", async () => {
    const app = generalApp({ limit: 1 });

    // Anonymous requests (no token/cookie) share the IP-keyed counter
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);

    // A session-bearing request from the exhausted IP is unaffected
    expect(
      (await request(app).get("/").set("authorization", "Bearer fresh")).status,
    ).toBe(200);
  });

  it("defaults to 100 requests per 15-minute window outside test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = generalApp();

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

  it("treats a malformed session_token cookie as anonymous instead of throwing", async () => {
    const app = generalApp({ limit: 2 });

    const res = await request(app)
      .get("/")
      .set("cookie", "better-auth.session_token=%");

    // Must not 500 (URIError); falls back to IP keying
    expect(res.status).toBe(200);
  });
});

describe("createAuthLimiter", () => {
  it("keys by normalized (lowercased/trimmed) req.body.email plus IP", async () => {
    const app = authApp({ limit: 1 });

    const first = await request(app)
      .post("/login")
      .send({ email: "  User@Example.com " });
    expect(first.status).toBe(200);

    // Same email (after normalization) AND same IP — shares the counter
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

  it("gives the same email independent counters across different IPs, so a griefer on one IP cannot lock out the victim's own IP", async () => {
    const app = authApp({ limit: 1 });

    // Attacker on 1.1.1.1 exhausts their own (email, IP) bucket for the victim's email
    const attacker1 = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "1.1.1.1")
      .send({ email: "victim@example.com" });
    expect(attacker1.status).toBe(200);
    const attacker2 = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "1.1.1.1")
      .send({ email: "victim@example.com" });
    expect(attacker2.status).toBe(429);

    // Victim's own request for the same email from a different IP is unaffected
    const victim = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "2.2.2.2")
      .send({ email: "victim@example.com" });
    expect(victim.status).toBe(200);
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

describe("createAuthAccountLimiter", () => {
  it("keys by normalized (lowercased/trimmed) req.body.email alone, ignoring IP", async () => {
    const app = authAccountApp({ limit: 1 });

    const first = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "1.1.1.1")
      .send({ email: "  User@Example.com ", fail: true });
    expect(first.status).toBe(401);

    // Same email after normalization, DIFFERENT IP — still shares the counter
    const second = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "2.2.2.2")
      .send({ email: "user@example.com", fail: true });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ message: "Too many requests" });
  });

  it("gives different emails independent counters", async () => {
    const app = authAccountApp({ limit: 1 });

    expect(
      (await request(app).post("/login").send({ email: "a@example.com", fail: true })).status,
    ).toBe(401);
    expect(
      (await request(app).post("/login").send({ email: "a@example.com", fail: true })).status,
    ).toBe(429);
    expect(
      (await request(app).post("/login").send({ email: "b@example.com" })).status,
    ).toBe(200);
  });

  it("falls back to IP keying when email is absent", async () => {
    const app = authAccountApp({ limit: 1 });

    expect((await request(app).post("/login").send({ fail: true })).status).toBe(401);
    expect((await request(app).post("/login").send({ fail: true })).status).toBe(429);

    // Email-keyed request from the exhausted IP is unaffected
    expect(
      (await request(app).post("/login").send({ email: "c@example.com" })).status,
    ).toBe(200);
  });

  it("defaults to 30 requests per 15-minute window with the pinned 429 response", async () => {
    const app = authAccountApp();

    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/login").send({ email: "d@example.com", fail: true });
      expect(res.status).toBe(401);
      // Pins the app defaults: limit 30 (q=30), windowMs 15 * 60 * 1000 (w=900s)
      expect(res.headers["ratelimit-policy"]).toMatch(/q=30;\s*w=900/);
    }

    const limited = await request(app)
      .post("/login")
      .send({ email: "d@example.com", fail: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many requests" });
    expect(limited.headers["ratelimit"]).toBeDefined();
    expect(limited.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("uses a custom store when provided", async () => {
    const store = stubStore(1);
    const app = authAccountApp({ store } as LimiterOptions);

    const res = await request(app).post("/login").send({ email: "e@example.com" });

    expect(res.status).toBe(200);
    expect(store.increment).toHaveBeenCalledTimes(1);
  });

  it("fails open (200) when the store errors and passOnStoreError is true", async () => {
    const store = erroringStore();
    const app = authAccountApp({ store, passOnStoreError: true } as LimiterOptions);

    const res = await request(app).post("/login").send({ email: "f@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(store.increment).toHaveBeenCalledTimes(1);
  });

  it("caps the same email in aggregate across several different source IPs (distributed-attack backstop)", async () => {
    const app = authAccountApp({ limit: 3 });

    // Each request comes from a distinct IP, so a per-(email,IP) limiter
    // (createAuthLimiter) would treat every one as its own fresh bucket —
    // but the pure-email account limiter counts them all together.
    const ips = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"];
    const statuses: number[] = [];
    for (const ip of ips) {
      const res = await request(app)
        .post("/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "victim@example.com", fail: true });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it("does not count successful (2xx) responses toward the shared per-email budget, but failed attempts still count", async () => {
    const app = authAccountApp({ limit: 1 });

    // Five real successful sign-ins for the same email never trip the limiter.
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/login").send({ email: "owner@example.com" });
      expect(res.status).toBe(200);
    }

    // A failed attempt (e.g. a credential-stuffing guess) still consumes the budget...
    const failed = await request(app)
      .post("/login")
      .send({ email: "owner@example.com", fail: true });
    expect(failed.status).toBe(401);

    // ...and the very next request against that key is blocked, whether or not
    // it would itself have succeeded (the residual risk called out in the
    // rateLimit.ts docstring/comment).
    const blocked = await request(app).post("/login").send({ email: "owner@example.com" });
    expect(blocked.status).toBe(429);
  });
});
