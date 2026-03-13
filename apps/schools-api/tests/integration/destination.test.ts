/**
 * Integration tests for destination routes.
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
  await prisma.destination.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.destination.deleteMany();
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

async function seedDestination(schoolId: number, overrides: Partial<{
  name: string;
  maxOccupancy: number | null;
}> = {}) {
  return prisma.destination.create({
    data: {
      schoolId,
      name: overrides.name ?? "Library",
      maxOccupancy: overrides.maxOccupancy ?? null,
    },
  });
}

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

describe("GET /api/schools/:schoolId/destinations (integration)", () => {
  it("TEACHER of the school can list destinations", async () => {
    const school = await seedSchool();
    await seedDestination(school.id, { name: "Library" });
    await seedDestination(school.id, { name: "Gym" });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("STUDENT of the school can list destinations", async () => {
    const school = await seedSchool();
    await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 403 for user from a different school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool("Other");
    const student = await seedUser({ role: "STUDENT", schoolId: otherSchool.id });
    authenticateAs(student);

    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.status).toBe(403);
  });

  it("excludes soft-deleted destinations", async () => {
    const school = await seedSchool();
    const d = await seedDestination(school.id, { name: "Deleted" });
    await prisma.destination.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await seedDestination(school.id, { name: "Active" });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Active");
  });

  it("SUPER_ADMIN can list destinations for any school", async () => {
    const school = await seedSchool();
    await seedDestination(school.id);
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.status).toBe(200);
  });
});

describe("POST /api/schools/:schoolId/destinations (integration)", () => {
  it("creates destination and persists to DB", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/destinations`)
      .send({ name: "Library", maxOccupancy: 30 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Library");
    expect(res.body.maxOccupancy).toBe(30);

    const inDb = await prisma.destination.findUnique({ where: { id: res.body.id } });
    expect(inDb?.name).toBe("Library");
  });

  it("creates destination without maxOccupancy", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .post(`/api/schools/${school.id}/destinations`)
      .send({ name: "Office" });

    expect(res.status).toBe(201);
    expect(res.body.maxOccupancy).toBeNull();
  });

  it("returns 403 for STUDENT", async () => {
    const school = await seedSchool();
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app)
      .post(`/api/schools/${school.id}/destinations`)
      .send({ name: "Gym" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when school does not exist", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app)
      .post("/api/schools/99999/destinations")
      .send({ name: "Gym" });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/schools/:schoolId/destinations/:id (integration)", () => {
  it("updates destination name", async () => {
    const school = await seedSchool();
    const dest = await seedDestination(school.id, { name: "Old Name" });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/destinations/${dest.id}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");

    const inDb = await prisma.destination.findUnique({ where: { id: dest.id } });
    expect(inDb?.name).toBe("New Name");
  });

  it("returns 404 when destination does not exist", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/schools/${school.id}/destinations/99999`)
      .send({ name: "X" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/schools/:schoolId/destinations/:id (integration)", () => {
  it("soft-deletes destination", async () => {
    const school = await seedSchool();
    const dest = await seedDestination(school.id);
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/destinations/${dest.id}`,
    );

    expect(res.status).toBe(204);

    const inDb = await prisma.destination.findUnique({ where: { id: dest.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("soft-deleted destination excluded from list", async () => {
    const school = await seedSchool();
    const dest = await seedDestination(school.id, { name: "Gone" });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    await request(app).delete(`/api/schools/${school.id}/destinations/${dest.id}`);
    const res = await request(app).get(`/api/schools/${school.id}/destinations`);

    expect(res.body.map((d: { id: number }) => d.id)).not.toContain(dest.id);
  });

  it("returns 404 when destination not found", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).delete(
      `/api/schools/${school.id}/destinations/99999`,
    );

    expect(res.status).toBe(404);
  });
});
