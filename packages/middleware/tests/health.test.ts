import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@hallpass/db", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

vi.mock("@hallpass/logger", () => ({
  logger: { error: vi.fn() },
}));

import { createHealthRoute } from "../src/health";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> };

function buildApp(serviceName: string) {
  const app = express();
  app.get("/health", createHealthRoute(serviceName));
  return app;
}

describe("createHealthRoute", () => {
  it("returns 200 with status ok and the given service name", async () => {
    const res = await request(buildApp("user-api")).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "user-api" });
  });

  it("reflects a different configured service name in the response", async () => {
    const res = await request(buildApp("schools-api")).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "schools-api" });
  });

  it("returns 503 when DB is unreachable", async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(buildApp("passes-api")).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", service: "passes-api" });
  });
});
