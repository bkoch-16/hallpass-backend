/**
 * Integration tests for district routes.
 * Uses real Prisma against live test DB. Auth is mocked.
 *
 * Run with: pnpm --filter @hallpass/schools-api test:integration
 * Requires: docker-compose up -d
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
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
  await prisma.$disconnect();
});

async function seedDistrict(name = "Test District") {
  return prisma.district.create({ data: { name } });
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

describe("GET /api/districts (integration)", () => {
  it("returns 403 for non-SUPER_ADMIN", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(403);
  });

  it("returns empty list when no districts exist", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns list of districts", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    await seedDistrict("District A");
    await seedDistrict("District B");
    authenticateAs(superAdmin);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("excludes soft-deleted districts", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const d = await seedDistrict("Deleted");
    await prisma.district.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await seedDistrict("Active");
    authenticateAs(superAdmin);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Active");
  });

  it("paginates with cursor", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const d1 = await seedDistrict("First");
    await seedDistrict("Second");
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/districts?limit=1&cursor=${d1.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Second");
  });
});

describe("POST /api/districts (integration)", () => {
  it("creates district and persists to DB", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app)
      .post("/api/districts")
      .send({ name: "New District" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New District");

    const inDb = await prisma.district.findUnique({ where: { id: res.body.id } });
    expect(inDb).not.toBeNull();
    expect(inDb?.name).toBe("New District");
  });

  it("returns 403 for non-SUPER_ADMIN", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/districts")
      .send({ name: "New District" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/districts/:id (integration)", () => {
  it("returns district by id", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict("Test District");
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/districts/${district.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(district.id);
    expect(res.body.name).toBe("Test District");
  });

  it("returns 404 for non-existent district", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app).get("/api/districts/99999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "District not found" });
  });

  it("returns 404 for soft-deleted district", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const d = await seedDistrict("Deleted");
    await prisma.district.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    authenticateAs(superAdmin);

    const res = await request(app).get(`/api/districts/${d.id}`);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/districts/:id (integration)", () => {
  it("updates name and persists to DB", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict("Old Name");
    authenticateAs(superAdmin);

    const res = await request(app)
      .patch(`/api/districts/${district.id}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");

    const inDb = await prisma.district.findUnique({ where: { id: district.id } });
    expect(inDb?.name).toBe("New Name");
  });

  it("returns 404 when district not found", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    authenticateAs(superAdmin);

    const res = await request(app).patch("/api/districts/99999").send({ name: "X" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/districts/:id (integration)", () => {
  it("soft-deletes district (sets deletedAt in DB)", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict("To Delete");
    authenticateAs(superAdmin);

    const res = await request(app).delete(`/api/districts/${district.id}`);

    expect(res.status).toBe(204);

    const inDb = await prisma.district.findUnique({ where: { id: district.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("soft-deleted district not returned in list", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const district = await seedDistrict("To Delete");
    authenticateAs(superAdmin);

    await request(app).delete(`/api/districts/${district.id}`);
    const res = await request(app).get("/api/districts");

    expect(res.body.data.map((d: { id: number }) => d.id)).not.toContain(district.id);
  });

  it("returns 404 for already deleted district", async () => {
    const superAdmin = await seedUser({ role: "SUPER_ADMIN" });
    const d = await seedDistrict("Gone");
    await prisma.district.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    authenticateAs(superAdmin);

    const res = await request(app).delete(`/api/districts/${d.id}`);

    expect(res.status).toBe(404);
  });
});
