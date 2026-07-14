/**
 * Integration tests for GET /api/passes/parent-lookup.
 * Uses real Prisma against live test DB, and the real ioredis-backed rate
 * limiter store against live test Redis. Auth is mocked (this route never
 * calls it — no requireAuth/session middleware is wired for this endpoint).
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: vi.fn().mockResolvedValue(null) },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

vi.mock("../../src/lib/slots.js", () => ({
  claimPassSlots: vi.fn().mockResolvedValue("claimed"),
  releasePassSlots: vi.fn().mockResolvedValue(undefined),
  promoteFromQueue: vi.fn().mockResolvedValue(undefined),
  reconcileSlots: vi.fn().mockResolvedValue(undefined),
  reconcileSchoolSlots: vi.fn().mockResolvedValue(undefined),
  getMaxActivePasses: vi.fn().mockResolvedValue(null),
  releaseAndPromote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../../src/lib/expiry.js", () => ({
  scheduleLocalExpiry: vi.fn(),
  expirePass: vi.fn().mockResolvedValue(undefined),
}));

import app from "../../src/app";
import { prisma } from "@hallpass/db";

const BASE = "/api/passes/parent-lookup";
const API_KEY_HEADER = "X-Api-Key";
const VALID_KEY = "test-parent-tool-api-key";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedSchool() {
  return prisma.school.create({ data: { name: "Test School", timezone: "UTC" } });
}

async function seedUser(
  schoolId: number,
  overrides: Partial<{
    role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN";
    pinCode: string | null;
    deletedAt: Date | null;
  }> = {},
) {
  return prisma.user.create({
    data: {
      email: `user-${crypto.randomUUID()}@test.com`,
      name: "Test User",
      role: overrides.role ?? "STUDENT",
      schoolId,
      pinCode: overrides.pinCode ?? null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function seedDestination(schoolId: number) {
  return prisma.destination.create({
    data: { schoolId, name: "Nurse's Office", maxOccupancy: 5 },
  });
}

async function seedPass(
  schoolId: number,
  studentId: number,
  destinationId: number,
  overrides: Partial<{
    status: "PENDING" | "WAITING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "DENIED" | "EXPIRED";
    activatedAt: Date | null;
    returnedAt: Date | null;
  }> = {},
) {
  return prisma.pass.create({
    data: {
      schoolId,
      studentId,
      requesterId: studentId,
      destinationId,
      status: overrides.status ?? "COMPLETED",
      activatedAt: overrides.activatedAt ?? null,
      returnedAt: overrides.returnedAt ?? null,
    },
  });
}

async function cleanDb() {
  await prisma.pass.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("GET /api/passes/parent-lookup (integration)", () => {
  it("200 returns the correct real data for a seeded pin", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser(school.id, { role: "STUDENT", pinCode: "5551234" });
    const activatedAt = new Date("2025-09-15T08:00:00Z");
    const returnedAt = new Date("2025-09-15T08:12:00Z");
    await seedPass(school.id, student.id, destination.id, {
      status: "COMPLETED",
      activatedAt,
      returnedAt,
    });

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "5551234" });

    expect(res.status).toBe(200);
    expect(res.body.student).toEqual({ id: student.id, name: student.name });
    expect(res.body.passes).toHaveLength(1);
    expect(res.body.passes[0]).toMatchObject({
      destination: "Nurse's Office",
      status: "COMPLETED",
      durationMinutes: 12,
    });
    expect(res.body.nextCursor).toBeNull();
  });

  it("404 for an unknown pin", async () => {
    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "nonexistent" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Student not found" });
  });

  it("404 for a soft-deleted student's pin", async () => {
    const school = await seedSchool();
    await seedUser(school.id, {
      role: "STUDENT",
      pinCode: "9998888",
      deletedAt: new Date(),
    });

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "9998888" });

    expect(res.status).toBe(404);
  });

  it("404 for a teacher's pin (not a student)", async () => {
    const school = await seedSchool();
    await seedUser(school.id, { role: "TEACHER", pinCode: "7776666" });

    const res = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, VALID_KEY)
      .query({ pin: "7776666" });

    expect(res.status).toBe(404);
  });

  it("401 for a missing/wrong API key", async () => {
    const noKey = await request(app).get(BASE).query({ pin: "1234" });
    expect(noKey.status).toBe(401);

    const wrongKey = await request(app)
      .get(BASE)
      .set(API_KEY_HEADER, "wrong-key")
      .query({ pin: "1234" });
    expect(wrongKey.status).toBe(401);
  });

  // Lower priority: pinCode is a User-level @unique column, so a raw insert
  // attempting to reuse an existing pinCode should surface Prisma's P2002.
  it("surfaces P2002 on a unique-constraint violation when two users share a pinCode", async () => {
    const school = await seedSchool();
    await seedUser(school.id, { role: "STUDENT", pinCode: "4443333" });

    await expect(
      seedUser(school.id, { role: "TEACHER", pinCode: "4443333" }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
