import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("@hallpass/db", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

vi.mock("@hallpass/logger", () => ({
  httpLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
  logger: { error: vi.fn() },
}));

import { createBaseApp } from "../src/baseApp";

describe("createBaseApp", () => {
  it("responds to GET /health", async () => {
    const app = createBaseApp("schools-api", { CORS_ORIGIN: "*" });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "schools-api" });
  });

  it("sets helmet security headers", async () => {
    const app = createBaseApp("schools-api", { CORS_ORIGIN: "*" });

    const res = await request(app).get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("echoes back an allowed origin with credentials", async () => {
    const app = createBaseApp("passes-api", { CORS_ORIGIN: "http://localhost:5173" });

    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("omits the CORS allow-origin header for a disallowed origin", async () => {
    const app = createBaseApp("passes-api", { CORS_ORIGIN: "http://localhost:5173" });

    const res = await request(app).get("/health").set("Origin", "http://example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("parses a JSON body on a route added after createBaseApp", async () => {
    const app = createBaseApp("user-api", { CORS_ORIGIN: "*" });
    app.post("/echo", (req, res) => res.json(req.body));

    const res = await request(app).post("/echo").send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: "world" });
  });

  it("trusts the first proxy hop for req.ip", async () => {
    const app = createBaseApp("user-api", { CORS_ORIGIN: "*" });
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));

    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.5");

    expect(res.body.ip).toBe("203.0.113.5");
  });
});
