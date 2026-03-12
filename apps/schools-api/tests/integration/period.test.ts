/**
 * Integration tests for period routes.
 * Uses real Prisma against live test DB. Auth is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

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

import app from "../../src/app";
import { prisma } from "@hallpass/db";

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.period.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.period.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.$disconnect();
});

async function seedSchool() {
  return prisma.school.create({ data: { name: "Test School" } });
}

async function seedScheduleType(schoolId: number) {
  return prisma.scheduleType.create({
    data: { schoolId, name: "A Block", startBuffer: 0, endBuffer: 0 },
  });
}

async function seedPeriod(scheduleTypeId: string, schoolId: number, order = 0) {
  return prisma.period.create({
    data: {
      schoolId,
      scheduleTypeId,
      name: `Period ${order + 1}`,
      startTime: "08:00",
      endTime: "09:00",
      order,
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

describe("GET /api/schools/:schoolId/schedule-types/:scheduleTypeId/periods (integration)", () => {
  it("returns periods for a schedule type", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    await seedPeriod(st.id, school.id, 0);
    await seedPeriod(st.id, school.id, 1);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).get(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].order).toBe(0);
    expect(res.body[1].order).toBe(1);
  });

  it("returns 404 when schedule type does not belong to the school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool();
    const st = await seedScheduleType(otherSchool.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).get(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Schedule type not found" });
  });

  it("excludes soft-deleted periods", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const p = await seedPeriod(st.id, school.id, 0);
    await prisma.period.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await seedPeriod(st.id, school.id, 1);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).get(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods`,
    );

    expect(res.body).toHaveLength(1);
  });
});

describe("POST .../periods (integration)", () => {
  it("creates period and persists to DB", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/schedule-types/${st.id}/periods`)
      .send({ name: "Lunch", startTime: "12:00", endTime: "12:45", order: 3 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Lunch");
    expect(res.body.startTime).toBe("12:00");
    expect(res.body.order).toBe(3);

    const inDb = await prisma.period.findUnique({ where: { id: res.body.id } });
    expect(inDb?.name).toBe("Lunch");
  });

  it("returns 403 for TEACHER", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app)
      .post(`/api/schools/${school.id}/schedule-types/${st.id}/periods`)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(403);
  });

  it("returns 404 when schedule type does not exist", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/schedule-types/nonexistent/periods`)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(404);
  });
});

describe("PATCH .../periods/:id (integration)", () => {
  it("updates period name and order", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const period = await seedPeriod(st.id, school.id, 0);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/schedule-types/${st.id}/periods/${period.id}`)
      .send({ name: "Renamed Period", order: 5 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Period");
    expect(res.body.order).toBe(5);
  });

  it("returns 404 when period does not exist", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/schedule-types/${st.id}/periods/nonexistent`)
      .send({ name: "X" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE .../periods/:id (integration)", () => {
  it("soft-deletes period", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const period = await seedPeriod(st.id, school.id, 0);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods/${period.id}`,
    );

    expect(res.status).toBe(204);

    const inDb = await prisma.period.findUnique({ where: { id: period.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("soft-deleted period not returned in list", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const period = await seedPeriod(st.id, school.id, 0);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    await request(app).delete(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods/${period.id}`,
    );

    const res = await request(app).get(
      `/api/schools/${school.id}/schedule-types/${st.id}/periods`,
    );
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain(period.id);
  });
});
