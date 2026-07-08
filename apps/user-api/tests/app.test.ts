import { createServer, type Server } from "node:http";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
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

// One shared server bound explicitly to 127.0.0.1 — supertest's default
// request(server) spawns a wildcard-bound server per request, whose port a
// foreign local process can shadow with a specific 127.0.0.1 bind (flaky
// hangs/ECONNRESET/wrong statuses; tech-debt item 12).
const server: Server = createServer(app);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

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
