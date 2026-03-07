/**
 * Integration tests — use real Prisma against a live test DB.
 * Auth (better-auth) is still mocked; everything else is real.
 *
 * Run with: pnpm --filter @hallpass/user-api test:integration
 * Requires: docker-compose up -d (PostgreSQL on localhost:5432)
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

// Do NOT mock @hallpass/db — use the real Prisma client.

import app from "../../src/app";
import { prisma } from "@hallpass/db";

beforeEach(async () => {
  vi.clearAllMocks();
  // Sessions and accounts are cascade-deleted with users.
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

function authenticateAs(user: { id: string; role: string }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

async function seedUser(overrides: Partial<{
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN";
  deletedAt: Date | null;
}> = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${crypto.randomUUID()}@test.com`,
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "STUDENT",
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

describe("GET /api/users/me (integration)", () => {
  it("returns own profile", async () => {
    const user = await seedUser({ role: "TEACHER" });
    authenticateAs(user);

    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe(user.email);
  });

  it("does not expose deletedAt or emailVerified", async () => {
    const user = await seedUser({ role: "TEACHER" });
    authenticateAs(user);

    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("deletedAt");
    expect(res.body).not.toHaveProperty("emailVerified");
  });

  it("returns 401 for a soft-deleted user", async () => {
    const user = await seedUser({ deletedAt: new Date() });
    // getSession returns the user ID, but requireAuth's findFirst
    // filters by deletedAt: null and finds nothing.
    mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });

    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/users/:id (integration)", () => {
  it("returns only the expected select fields (no deletedAt)", async () => {
    const teacher = await seedUser({ role: "TEACHER" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/users/${student.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: student.id, email: student.email });
    expect(res.body).not.toHaveProperty("deletedAt");
    expect(res.body).not.toHaveProperty("emailVerified");
  });

  it("returns 404 for a soft-deleted target user", async () => {
    const teacher = await seedUser({ role: "TEACHER" });
    const deleted = await seedUser({ deletedAt: new Date() });
    authenticateAs(teacher);

    const res = await request(app).get(`/api/users/${deleted.id}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/users (integration)", () => {
  it("returns only active users (excludes soft-deleted)", async () => {
    const teacher = await seedUser({ role: "TEACHER" });
    await seedUser({ role: "STUDENT" });
    await seedUser({ role: "STUDENT", deletedAt: new Date() });
    authenticateAs(teacher);

    const res = await request(app).get("/api/users");

    expect(res.status).toBe(200);
    // teacher + 1 active student = 2; deleted student excluded
    expect(res.body.data).toHaveLength(2);
  });

  it("filters by ?role=", async () => {
    const teacher = await seedUser({ role: "TEACHER" });
    await seedUser({ role: "STUDENT" });
    await seedUser({ role: "STUDENT" });
    authenticateAs(teacher);

    const res = await request(app).get("/api/users?role=STUDENT");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((u: { role: string }) => u.role === "STUDENT")).toBe(true);
  });

  it("returns specific users when ?ids= provided", async () => {
    const teacher = await seedUser({ role: "TEACHER" });
    const a = await seedUser({ role: "STUDENT" });
    await seedUser({ role: "STUDENT" }); // not requested
    authenticateAs(teacher);

    const res = await request(app).get(`/api/users?ids=${a.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(a.id);
  });
});

describe("POST /api/users (integration)", () => {
  it("creates a user and persists to DB", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@test.com");

    const inDb = await prisma.user.findUnique({ where: { id: res.body.id } });
    expect(inDb).not.toBeNull();
    expect(inDb?.email).toBe("new@test.com");
  });

  it("returns 409 on unique constraint violation (duplicate email)", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    await seedUser({ email: "dup@test.com", role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "dup@test.com", name: "Duplicate" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Email already in use" });
  });

  it("response does not expose deletedAt or emailVerified", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "clean@test.com", name: "Clean" });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("deletedAt");
    expect(res.body).not.toHaveProperty("emailVerified");
  });
});

describe("PATCH /api/users/:id (integration)", () => {
  it("updates name and persists to DB", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");

    const inDb = await prisma.user.findUnique({ where: { id: student.id } });
    expect(inDb?.name).toBe("Updated Name");
  });

  it("updates email and persists to DB", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ email: "updated@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("updated@test.com");

    const inDb = await prisma.user.findUnique({ where: { id: student.id } });
    expect(inDb?.email).toBe("updated@test.com");
  });

  it("updates role and persists to DB", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ role: "TEACHER" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("TEACHER");

    const inDb = await prisma.user.findUnique({ where: { id: student.id } });
    expect(inDb?.role).toBe("TEACHER");
  });

  it("returns 404 when target user does not exist", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/nonexistent-id`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 404 when target user is soft-deleted", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const deleted = await seedUser({ deletedAt: new Date() });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${deleted.id}`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when promoting to role above caller", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);

    const inDb = await prisma.user.findUnique({ where: { id: student.id } });
    expect(inDb?.role).toBe("STUDENT");
  });

  it("allows student to update their own name", async () => {
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(student);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ name: "My New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("My New Name");
  });

  it("response does not expose deletedAt or emailVerified", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .patch(`/api/users/${student.id}`)
      .send({ name: "Clean Response" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("deletedAt");
    expect(res.body).not.toHaveProperty("emailVerified");
  });
});

describe("POST /api/users/bulk (integration)", () => {
  it("creates all users and persists to DB", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users/bulk")
      .send([
        { email: "bulk1@test.com", name: "Bulk One" },
        { email: "bulk2@test.com", name: "Bulk Two" },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toHaveLength(0);

    const inDb = await prisma.user.findMany({
      where: { email: { in: ["bulk1@test.com", "bulk2@test.com"] } },
    });
    expect(inDb).toHaveLength(2);
  });

  it("returns partial success when some users fail (duplicate email)", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    await seedUser({ email: "existing@test.com", role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users/bulk")
      .send([
        { email: "existing@test.com", name: "Duplicate" },
        { email: "fresh@test.com", name: "Fresh" },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].email).toBe("existing@test.com");
  });

  it("returns 400 when all users fail", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    await seedUser({ email: "dup1@test.com", role: "STUDENT" });
    await seedUser({ email: "dup2@test.com", role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users/bulk")
      .send([
        { email: "dup1@test.com", name: "Dup One" },
        { email: "dup2@test.com", name: "Dup Two" },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.created).toBe(0);
    expect(res.body.failed).toHaveLength(2);
  });

  it("returns 403 when any user has role above caller", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users/bulk")
      .send([{ email: "elevated@test.com", name: "Elevated", role: "SUPER_ADMIN" }]);

    expect(res.status).toBe(403);

    const inDb = await prisma.user.findFirst({ where: { email: "elevated@test.com" } });
    expect(inDb).toBeNull();
  });
});

describe("DELETE /api/users/:id (integration)", () => {
  it("soft-deletes the user (sets deletedAt in DB)", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    const res = await request(app).delete(`/api/users/${student.id}`);

    expect(res.status).toBe(204);

    const inDb = await prisma.user.findUnique({ where: { id: student.id } });
    expect(inDb?.deletedAt).not.toBeNull();
  });

  it("soft-deleted user cannot be found via GET", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const student = await seedUser({ role: "STUDENT" });
    authenticateAs(admin);

    await request(app).delete(`/api/users/${student.id}`);
    const res = await request(app).get(`/api/users/${student.id}`);

    expect(res.status).toBe(404);
  });
});
