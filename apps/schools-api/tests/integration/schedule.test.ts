/**
 * Integration tests for the schedule route.
 * Uses real Prisma against live test DB. Auth is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { createTestServer } from "@hallpass/express-middleware";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app.js";
import { prisma } from "@hallpass/db";

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.period.deleteMany();
  await prisma.schoolCalendar.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.period.deleteMany();
  await prisma.schoolCalendar.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.$disconnect();
});

async function seedSchool(timezone = "UTC") {
  return prisma.school.create({ data: { name: "Test School", timezone } });
}

async function seedScheduleType(
  schoolId: number,
  overrides: Partial<{ startBuffer: number; endBuffer: number }> = {},
) {
  return prisma.scheduleType.create({
    data: {
      schoolId,
      name: "Standard Day",
      startBuffer: overrides.startBuffer ?? 0,
      endBuffer: overrides.endBuffer ?? 0,
    },
  });
}

async function seedPeriod(
  scheduleTypeId: number,
  schoolId: number,
  overrides: Partial<{ name: string; startTime: string; endTime: string; order: number }> = {},
) {
  return prisma.period.create({
    data: {
      schoolId,
      scheduleTypeId,
      name: overrides.name ?? "Period 1",
      startTime: overrides.startTime ?? "08:00",
      endTime: overrides.endTime ?? "09:00",
      order: overrides.order ?? 0,
    },
  });
}

async function seedUser(overrides: Partial<{
  role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN";
  schoolId: number | null;
}> = {}) {
  return prisma.user.create({
    data: {
      email: `user-${crypto.randomUUID()}@test.com`,
      name: "Test User",
      role: overrides.role ?? "STUDENT",
      schoolId: overrides.schoolId ?? null,
    },
  });
}

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe("GET /api/schools/:schoolId/schedule/today (integration)", () => {
  it("returns 404 when the school does not exist", async () => {
    const admin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(admin);

    const res = await request(server).get("/api/schools/999999/schedule/today");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "School not found" });
  });

  it("returns 403 for a user from another school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: otherSchool.id });
    authenticateAs(teacher);

    const res = await request(server).get(`/api/schools/${school.id}/schedule/today`);

    expect(res.status).toBe(403);
  });

  it("200 with an empty schedule when no calendar entry exists for today", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(server).get(`/api/schools/${school.id}/schedule/today`);

    expect(res.status).toBe(200);
    expect(res.body.scheduleType).toBeNull();
    expect(res.body.periods).toEqual([]);
    expect(res.body.currentPeriod).toBeNull();
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves the current period from a real calendar entry, schedule type, and periods", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T09:30:00Z")); // 09:30 UTC, school timezone is UTC
    try {
      const school = await seedSchool("UTC");
      const st = await seedScheduleType(school.id);
      await prisma.schoolCalendar.create({
        data: {
          schoolId: school.id,
          date: new Date("2026-07-21T00:00:00Z"),
          scheduleTypeId: st.id,
        },
      });
      const period = await seedPeriod(st.id, school.id, {
        startTime: "09:00",
        endTime: "10:00",
        order: 0,
      });
      const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
      authenticateAs(teacher);

      const res = await request(server).get(`/api/schools/${school.id}/schedule/today`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe("2026-07-21");
      expect(res.body.scheduleType).toMatchObject({ id: st.id, name: "Standard Day" });
      expect(res.body.periods).toHaveLength(1);
      expect(res.body.currentPeriod).toMatchObject({
        id: period.id,
        name: "Period 1",
        windowStart: "09:00",
        windowEnd: "10:00",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
