import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({ api: { getSession: vi.fn() } })),
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

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "user-api" });
  });
});

describe("undefined routes", () => {
  it("returns 404 with not found message", async () => {
    const res = await request(app).get("/api/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });
});
