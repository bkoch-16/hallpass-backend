/**
 * Integration tests for calendar routes.
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
  await prisma.schoolCalendar.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.schoolCalendar.deleteMany();
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

describe("GET /api/schools/:schoolId/calendar (integration)", () => {
  it("returns calendar entries for the school", async () => {
    const school = await seedSchool();
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01") },
    });
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-02") },
    });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/calendar`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters by ?from= date", async () => {
    const school = await seedSchool();
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-08-31") }, // before from
    });
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01") }, // on from
    });
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-15") }, // after from
    });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(
      `/api/schools/${school.id}/calendar?from=2025-09-01`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // Sept 1 and 15
  });

  it("filters by ?to= date", async () => {
    const school = await seedSchool();
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01") },
    });
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-12-01") }, // after to
    });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(
      `/api/schools/${school.id}/calendar?to=2025-11-30`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /api/schools/:schoolId/calendar (bulk upsert, integration)", () => {
  it("creates new entries and returns created count", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01" }, { date: "2025-09-02" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.updated).toBe(0);

    const inDb = await prisma.schoolCalendar.findMany({ where: { schoolId: school.id } });
    expect(inDb).toHaveLength(2);
  });

  it("updates existing entry (upsert)", async () => {
    const school = await seedSchool();
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01"), note: "Old note" },
    });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01", note: "Updated note" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.updated).toBe(1);

    const inDb = await prisma.schoolCalendar.findFirst({
      where: { schoolId: school.id, date: new Date("2025-09-01") },
    });
    expect(inDb?.note).toBe("Updated note");
  });

  it("handles mix of new and existing entries", async () => {
    const school = await seedSchool();
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01") },
    });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01", note: "Updated" }, { date: "2025-09-02" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(1);
  });

  it("returns 422 when scheduleTypeId does not belong to this school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool();
    const st = await seedScheduleType(otherSchool.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01", scheduleTypeId: st.id }]);

    expect(res.status).toBe(422);
  });

  it("links valid scheduleTypeId to calendar entry", async () => {
    const school = await seedSchool();
    const st = await seedScheduleType(school.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01", scheduleTypeId: st.id }]);

    expect(res.status).toBe(200);
    const inDb = await prisma.schoolCalendar.findFirst({ where: { schoolId: school.id } });
    expect(inDb?.scheduleTypeId).toBe(st.id);
  });

  it("returns 403 for TEACHER", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app)
      .post(`/api/schools/${school.id}/calendar`)
      .send([{ date: "2025-09-01" }]);

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/schools/:schoolId/calendar/:id (integration)", () => {
  it("updates calendar entry note", async () => {
    const school = await seedSchool();
    const entry = await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01"), note: "Original" },
    });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/calendar/${entry.id}`)
      .send({ note: "Updated" });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe("Updated");
  });

  it("returns 404 when entry does not exist", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/calendar/nonexistent`)
      .send({ note: "X" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/schools/:schoolId/calendar/:id (integration)", () => {
  it("deletes calendar entry from DB", async () => {
    const school = await seedSchool();
    const entry = await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-10-31") },
    });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/calendar/${entry.id}`,
    );

    expect(res.status).toBe(204);

    const inDb = await prisma.schoolCalendar.findUnique({ where: { id: entry.id } });
    expect(inDb).toBeNull(); // hard delete
  });

  it("returns 404 for non-existent entry", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/calendar/nonexistent`,
    );

    expect(res.status).toBe(404);
  });
});
