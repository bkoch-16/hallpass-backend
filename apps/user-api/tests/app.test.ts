import { describe, it, expect, vi } from "vitest";
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

import app from "../src/app";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
};

describe("Helmet security headers", () => {
  it("sets X-Content-Type-Options: nosniff on all responses", async () => {
    const res = await request(app).get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options on all responses", async () => {
    const res = await request(app).get("/health");

    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});

describe("CORS headers", () => {
  it("returns Access-Control-Allow-Origin: * when CORS_ORIGIN is *", async () => {
    const res = await request(app).get("/health").set("Origin", "http://example.com");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("Global error handler", () => {
  it("returns 500 with message when an unhandled error propagates from middleware", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" }, session: {} });
    mockPrisma.user.findFirst.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});
