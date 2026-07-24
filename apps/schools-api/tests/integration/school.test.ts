/**
 * Integration tests for school routes.
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
  await prisma.pass.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
});

afterAll(async () => {
  await prisma.pass.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
  await prisma.$disconnect();
});

async function seedDistrict(name = "Test District") {
  return prisma.district.create({ data: { name } });
}

async function seedSchool(overrides: Partial<{
  name: string;
  timezone: string;
  districtId: number | null;
}> = {}) {
  return prisma.school.create({
    data: {
      name: overrides.name ?? "Test School",
      timezone: overrides.timezone,
      ...(overrides.districtId !== undefined ? { districtId: overrides.districtId } : {}),
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

async function seedDestination(schoolId: number, name = "Library") {
  return prisma.destination.create({ data: { schoolId, name } });
}

async function seedPass(
  schoolId: number,
  destinationId: number,
  studentId: number,
  status: "PENDING" | "WAITING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "DENIED" | "EXPIRED",
) {
  return prisma.pass.create({
    data: {
      schoolId,
      destinationId,
      studentId,
      requesterId: studentId,
      status,
    },
  });
}

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe("GET /api/schools (integration)", () => {
  it("returns 403 for ADMIN", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(server).get("/api/schools");

    expect(res.status).toBe(403);
  });

  it("returns list of schools for SUPER_ADMIN", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    await seedSchool({ name: "School A" });
    await seedSchool({ name: "School B" });
    authenticateAs(superAdmin);

    const res = await request(server).get("/api/schools");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("excludes soft-deleted schools", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const s = await seedSchool({ name: "Deleted" });
    await prisma.school.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    await seedSchool({ name: "Active" });
    authenticateAs(superAdmin);

    const res = await request(server).get("/api/schools");

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Active");
  });
});

describe("POST /api/schools (integration)", () => {
  it("creates school with name only", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(server)
      .post("/api/schools")
      .send({ name: "New School" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New School");
    expect(res.body.timezone).toBe("America/Los_Angeles"); // default

    const inDb = await prisma.school.findUnique({ where: { id: res.body.id } });
    expect(inDb).not.toBeNull();
  });

  it("creates school with custom timezone", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(server)
      .post("/api/schools")
      .send({ name: "East School", timezone: "America/New_York" });

    expect(res.status).toBe(201);
    expect(res.body.timezone).toBe("America/New_York");
  });

  it("creates school linked to district", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict("Central District");
    authenticateAs(superAdmin);

    const res = await request(server)
      .post("/api/schools")
      .send({ name: "West School", districtId: district.id });

    expect(res.status).toBe(201);
    expect(res.body.districtId).toBe(district.id);
  });
});

describe("GET /api/schools/:id (integration)", () => {
  it("returns school by id", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const school = await seedSchool({ name: "Riverside" });
    authenticateAs(superAdmin);

    const res = await request(server).get(`/api/schools/${school.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(school.id);
    expect(res.body.name).toBe("Riverside");
  });

  it("returns 404 for non-existent school", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(server).get("/api/schools/99999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "School not found" });
  });
});

describe("PATCH /api/schools/:id (integration)", () => {
  it("updates school name", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const school = await seedSchool({ name: "Old Name" });
    authenticateAs(superAdmin);

    const res = await request(server)
      .patch(`/api/schools/${school.id}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");

    const inDb = await prisma.school.findUnique({ where: { id: school.id } });
    expect(inDb?.name).toBe("New Name");
  });

  it("can set districtId to null (unlink)", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict();
    const school = await seedSchool({ districtId: district.id });
    authenticateAs(superAdmin);

    const res = await request(server)
      .patch(`/api/schools/${school.id}`)
      .send({ districtId: null });

    expect(res.status).toBe(200);
    expect(res.body.districtId).toBeNull();
  });
});

describe("DELETE /api/schools/:id (integration)", () => {
  it("soft-deletes school (sets deletedAt in DB)", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const school = await seedSchool({ name: "To Delete" });
    authenticateAs(superAdmin);

    const res = await request(server).delete(`/api/schools/${school.id}`);

    expect(res.status).toBe(204);

    const inDb = await prisma.school.findUnique({ where: { id: school.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("soft-deleted school excluded from list", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const school = await seedSchool({ name: "Gone" });
    authenticateAs(superAdmin);

    await request(server).delete(`/api/schools/${school.id}`);
    const res = await request(server).get("/api/schools");

    expect(res.body.data.map((s: { id: number }) => s.id)).not.toContain(school.id);
  });

  it("returns 409 and does not delete when school has active users", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const school = await seedSchool({ name: "Has Users" });
    await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(superAdmin);

    const res = await request(server).delete(`/api/schools/${school.id}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Cannot delete: school has active users" });

    const inDb = await prisma.school.findUnique({ where: { id: school.id } });
    expect(inDb?.deletedAt).toBeNull();
  });

  it.each(["PENDING", "WAITING", "ACTIVE"] as const)(
    "returns 409 and does not delete when a %s pass belongs to the school",
    async (status) => {
      const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
      const school = await seedSchool({ name: "Has Passes" });
      const dest = await seedDestination(school.id);
      const student = await seedUser({ role: "STUDENT" });
      await seedPass(school.id, dest.id, student.id, status);
      authenticateAs(superAdmin);

      const res = await request(server).delete(`/api/schools/${school.id}`);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ message: "Cannot delete: school has in-flight passes" });

      const inDb = await prisma.school.findUnique({ where: { id: school.id } });
      expect(inDb?.deletedAt).toBeNull();
    },
  );

  it.each(["COMPLETED", "CANCELLED", "DENIED", "EXPIRED"] as const)(
    "returns 204 when only a %s (terminal) pass belongs to the school",
    async (status) => {
      const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
      const school = await seedSchool({ name: "Terminal Passes" });
      const dest = await seedDestination(school.id);
      const student = await seedUser({ role: "STUDENT" });
      await seedPass(school.id, dest.id, student.id, status);
      authenticateAs(superAdmin);

      const res = await request(server).delete(`/api/schools/${school.id}`);

      expect(res.status).toBe(204);

      const inDb = await prisma.school.findUnique({ where: { id: school.id } });
      expect(inDb?.deletedAt).not.toBeNull();
    },
  );
});
