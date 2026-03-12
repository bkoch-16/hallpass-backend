/**
 * Integration tests for schedule type routes.
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

async function seedSchool(name = "Test School") {
  return prisma.school.create({ data: { name } });
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

async function seedScheduleType(schoolId: number, name = "A Block") {
  return prisma.scheduleType.create({
    data: { schoolId, name, startBuffer: 0, endBuffer: 0 },
  });
}

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

describe("GET /api/schools/:schoolId/schedule-types (integration)", () => {
  it("returns schedule types for the school", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    await seedScheduleType(school.id, "A Block");
    await seedScheduleType(school.id, "B Block");
    authenticateAs(admin);

    const res = await request(app).get(`/api/schools/${school.id}/schedule-types`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns 403 for user from different school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool("Other");
    const admin = await seedUser({ role: "ADMIN", schoolId: otherSchool.id });
    authenticateAs(admin);

    const res = await request(app).get(`/api/schools/${school.id}/schedule-types`);

    expect(res.status).toBe(403);
  });

  it("excludes soft-deleted schedule types", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    const st = await seedScheduleType(school.id, "Deleted");
    await prisma.scheduleType.update({ where: { id: st.id }, data: { deletedAt: new Date() } });
    await seedScheduleType(school.id, "Active");
    authenticateAs(admin);

    const res = await request(app).get(`/api/schools/${school.id}/schedule-types`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Active");
  });

  it("SUPER_ADMIN can access any school", async () => {
    const school = await seedSchool();
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    await seedScheduleType(school.id);
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/schools/${school.id}/schedule-types`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /api/schools/:schoolId/schedule-types (integration)", () => {
  it("creates schedule type and persists to DB", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/schedule-types`)
      .send({ name: "C Block", startBuffer: 5, endBuffer: 10 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("C Block");
    expect(res.body.startBuffer).toBe(5);
    expect(res.body.endBuffer).toBe(10);

    const inDb = await prisma.scheduleType.findUnique({ where: { id: res.body.id } });
    expect(inDb?.name).toBe("C Block");
  });

  it("returns 403 for TEACHER", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app)
      .post(`/api/schools/${school.id}/schedule-types`)
      .send({ name: "D Block" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when school does not exist", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app)
      .post("/api/schools/99999/schedule-types")
      .send({ name: "A Block" });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/schools/:schoolId/schedule-types/:id (integration)", () => {
  it("updates schedule type name", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    const st = await seedScheduleType(school.id, "Old Name");
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/schedule-types/${st.id}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");

    const inDb = await prisma.scheduleType.findUnique({ where: { id: st.id } });
    expect(inDb?.name).toBe("New Name");
  });

  it("returns 404 when schedule type does not exist", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/schedule-types/nonexistent-id`)
      .send({ name: "X" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/schools/:schoolId/schedule-types/:id (integration)", () => {
  it("soft-deletes schedule type", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    const st = await seedScheduleType(school.id, "To Delete");
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/schedule-types/${st.id}`,
    );

    expect(res.status).toBe(204);

    const inDb = await prisma.scheduleType.findUnique({ where: { id: st.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("returns 409 when referenced by a calendar entry", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    const st = await seedScheduleType(school.id, "Referenced");
    await prisma.schoolCalendar.create({
      data: { schoolId: school.id, date: new Date("2025-09-01"), scheduleTypeId: st.id },
    });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/schedule-types/${st.id}`,
    );

    expect(res.status).toBe(409);

    const inDb = await prisma.scheduleType.findUnique({ where: { id: st.id } });
    expect(inDb?.deletedAt).toBeNull();
  });

  it("returns 404 for non-existent schedule type", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/schedule-types/nonexistent`,
    );

    expect(res.status).toBe(404);
  });
});
