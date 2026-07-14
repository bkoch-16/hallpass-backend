import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { passStatusMock } from "../utils/passStatusMock.js";

const { mockGetSession, mockRedisEval } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedisEval: vi.fn(),
}));

// The parent-lookup route runs behind the pin-lookup rate limiter, whose
// RedisStore calls redis.eval. Mock the ioredis client so the route tests
// don't depend on a live Redis (CI has none); an unmocked eval rejects and the
// limiter fails closed with a 500. See pinLookupLimiter.test.ts.
vi.mock("../../src/lib/redis.js", () => ({
  redis: {
    eval: mockRedisEval,
    del: vi.fn(),
  },
}));

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    schoolCalendar: { findFirst: vi.fn() },
    period: { findFirst: vi.fn(), findMany: vi.fn() },
    passPolicy: { findFirst: vi.fn() },
    destination: { findUnique: vi.fn(), findFirst: vi.fn() },
    pass: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../../src/lib/slots.js", () => ({
  claimPassSlots: vi.fn().mockResolvedValue("claimed"),
  releasePassSlots: vi.fn().mockResolvedValue(undefined),
  releaseAndPromote: vi.fn().mockResolvedValue(undefined),
  getMaxActivePasses: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../../src/lib/queue.js", () => ({
  schedulePassExpiry: vi.fn().mockResolvedValue(undefined),
  startExpiryWorker: vi.fn(),
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
  pass: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

const BASE = "/api/passes/parent-lookup";
const API_KEY_HEADER = "X-Api-Key";
const VALID_KEY = "test-parent-tool-api-key";

const fakeStudent = { id: 10, name: "Student One" };

const fakePassRow = {
  id: 100,
  status: "COMPLETED",
  requestedAt: new Date("2025-09-15T08:00:00Z"),
  activatedAt: new Date("2025-09-15T08:05:00Z"),
  returnedAt: new Date("2025-09-15T08:15:00Z"),
  destination: { name: "Bathroom" },
};

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks wipes mockGetSession's resolved value from prior tests —
  // this route never calls it, but reset defensively to avoid cross-test leakage.
  mockGetSession.mockResolvedValue(null);
  // resetAllMocks clears the eval implementation; restore it each test. Returns
  // [count, ttl] as the limiter's Lua INCREMENT script does — a count of 1 keeps
  // every request under the limit.
  mockRedisEval.mockResolvedValue([1, 15 * 60 * 1000]);
});

describe("GET /api/passes/parent-lookup", () => {
  it("returns 401 when the API key header is missing", async () => {
    const res = await request(app).get(BASE).query({ pin: "1234" });

    expect(res.status).toBe(401);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("returns 401 when the API key is wrong", async () => {
    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, "wrong-key")
      .query({ pin: "1234" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when the pin query param is missing", async () => {
    const res = await request(app).get(BASE).set(API_KEY_HEADER, VALID_KEY);

    expect(res.status).toBe(400);
  });

  it("returns 404 when no student matches the pin", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "0000" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Student not found" });
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { pinCode: "0000", role: "STUDENT", deletedAt: null },
      select: { id: true, name: true },
    });
  });

  it("returns 200 with the student and their passes on a match", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(fakeStudent);
    mockPrisma.pass.findMany.mockResolvedValue([fakePassRow]);

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.student).toEqual(fakeStudent);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.passes).toHaveLength(1);
    expect(res.body.passes[0]).toMatchObject({
      id: 100,
      destination: "Bathroom",
      status: "COMPLETED",
      durationMinutes: 10,
    });

    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: fakeStudent.id },
        take: 51, // default limit (50) + 1
        orderBy: { id: "desc" },
      }),
    );
  });

  it("computes durationMinutes as null unless both activatedAt and returnedAt are set", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(fakeStudent);
    mockPrisma.pass.findMany.mockResolvedValue([
      { ...fakePassRow, id: 101, activatedAt: null, returnedAt: null },
      { ...fakePassRow, id: 102, activatedAt: new Date(), returnedAt: null },
    ]);

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.passes[0].durationMinutes).toBeNull();
    expect(res.body.passes[1].durationMinutes).toBeNull();
  });

  it("returns nextCursor when there are more results than the page size", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(fakeStudent);
    // limit=2 → take: 3; prisma returns 3 rows, meaning there's a next page
    mockPrisma.pass.findMany.mockResolvedValue([
      { ...fakePassRow, id: 103 },
      { ...fakePassRow, id: 102 },
      { ...fakePassRow, id: 101 },
    ]);

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "1234", limit: "2" });

    expect(res.status).toBe(200);
    expect(res.body.passes).toHaveLength(2);
    expect(res.body.nextCursor).toBe("102");
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: { id: "desc" } }),
    );
  });

  it("never invokes session/auth resolution for this route", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(fakeStudent);
    mockPrisma.pass.findMany.mockResolvedValue([]);

    await request(app).get(BASE).set(API_KEY_HEADER, VALID_KEY).query({ pin: "1234" });

    expect(mockGetSession).not.toHaveBeenCalled();
  });
});
