/**
 * Integration tests for policy routes.
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
  await prisma.passPolicy.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.passPolicy.deleteMany();
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

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

describe("GET /api/schools/:schoolId/policy (integration)", () => {
  it("returns 404 when no policy is set", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/policy`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "No policy set for this school" });
  });

  it("returns policy when it exists", async () => {
    const school = await seedSchool();
    await prisma.passPolicy.create({
      data: {
        schoolId: school.id,
        maxActivePasses: 3,
        interval: "DAY",
        maxPerInterval: 5,
      },
    });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/policy`);

    expect(res.status).toBe(200);
    expect(res.body.maxActivePasses).toBe(3);
    expect(res.body.interval).toBe("DAY");
    expect(res.body.maxPerInterval).toBe(5);
  });

  it("returns 403 for user from different school", async () => {
    const school = await seedSchool();
    const otherSchool = await seedSchool("Other");
    const teacher = await seedUser({ role: "TEACHER", schoolId: otherSchool.id });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/schools/${school.id}/policy`);

    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN can read policy for any school", async () => {
    const school = await seedSchool();
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/schools/${school.id}/policy`);

    expect(res.status).toBe(404); // no policy, but not 403
  });
});

describe("PUT /api/schools/:schoolId/policy (integration)", () => {
  it("creates policy when none exists (upsert)", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .put(`/api/schools/${school.id}/policy`)
      .send({ maxActivePasses: 2, interval: "WEEK", maxPerInterval: 10 });

    expect(res.status).toBe(200);
    expect(res.body.maxActivePasses).toBe(2);
    expect(res.body.interval).toBe("WEEK");
    expect(res.body.maxPerInterval).toBe(10);

    const inDb = await prisma.passPolicy.findUnique({ where: { schoolId: school.id } });
    expect(inDb?.maxActivePasses).toBe(2);
  });

  it("updates existing policy (upsert overwrites)", async () => {
    const school = await seedSchool();
    await prisma.passPolicy.create({
      data: { schoolId: school.id, maxActivePasses: 1, interval: "DAY", maxPerInterval: 3 },
    });
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .put(`/api/schools/${school.id}/policy`)
      .send({ maxActivePasses: 5, interval: "MONTH", maxPerInterval: 20 });

    expect(res.status).toBe(200);
    expect(res.body.maxActivePasses).toBe(5);
    expect(res.body.interval).toBe("MONTH");

    const inDb = await prisma.passPolicy.findUnique({ where: { schoolId: school.id } });
    expect(inDb?.interval).toBe("MONTH");
  });

  it("only one policy per school (unique constraint enforced)", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    await request(app).put(`/api/schools/${school.id}/policy`).send({ maxActivePasses: 1 });
    await request(app).put(`/api/schools/${school.id}/policy`).send({ maxActivePasses: 2 });

    const policies = await prisma.passPolicy.findMany({ where: { schoolId: school.id } });
    expect(policies).toHaveLength(1);
    expect(policies[0].maxActivePasses).toBe(2);
  });

  it("returns 403 for TEACHER", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app)
      .put(`/api/schools/${school.id}/policy`)
      .send({ maxActivePasses: 5 });

    expect(res.status).toBe(403);
  });

  it("returns 404 when school does not exist", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app)
      .put("/api/schools/99999/policy")
      .send({ maxActivePasses: 5 });

    expect(res.status).toBe(404);
  });

  it("accepts empty body (null policy)", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app).put(`/api/schools/${school.id}/policy`).send({});

    expect(res.status).toBe(200);
    expect(res.body.maxActivePasses).toBeNull();
    expect(res.body.interval).toBeNull();
  });

  it("returns 400 when interval set without maxPerInterval", async () => {
    const school = await seedSchool();
    const admin = await seedUser({ role: "ADMIN", schoolId: school.id });
    authenticateAs(admin);

    const res = await request(app)
      .put(`/api/schools/${school.id}/policy`)
      .send({ interval: "DAY" });

    expect(res.status).toBe(400);
  });
});
