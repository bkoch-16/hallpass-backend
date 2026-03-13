import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    destination: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
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

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
  school: { findFirst: ReturnType<typeof vi.fn> };
  destination: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

interface FakeUser {
  id: number;
  role: string;
  schoolId: number | null;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const fakeAdmin: FakeUser = {
  id: 1,
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeTeacher: FakeUser = {
  id: 2,
  email: "teacher@test.com",
  name: "Teacher",
  role: "TEACHER",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeStudent: FakeUser = {
  id: 3,
  email: "student@test.com",
  name: "Student",
  role: "STUDENT",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeSuperAdmin: FakeUser = {
  id: 4,
  email: "superadmin@test.com",
  name: "Super Admin",
  role: "SUPER_ADMIN",
  schoolId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeWrongSchool: FakeUser = {
  id: 5,
  email: "other@test.com",
  name: "Other",
  role: "STUDENT",
  schoolId: 99,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user: { id: String(user.id) }, session: {} });
  mockPrisma.user.findFirst.mockResolvedValue(user);
}

const fakeDestination = {
  id: 1,
  schoolId: 1,
  name: "Library",
  maxOccupancy: 30,
};

const BASE = "/api/schools/1/destinations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe(`GET ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(401);
  });

  it("TEACHER of the same school can list destinations", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.destination.findMany.mockResolvedValue([fakeDestination]);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Library");
  });

  it("STUDENT of the same school can list destinations", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.destination.findMany.mockResolvedValue([fakeDestination]);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
  });

  it("returns 403 when user is from a different school", async () => {
    authenticateAs(fakeWrongSchool);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(403);
  });
});

describe(`POST ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).post(BASE).send({ name: "Gym" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts create", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app).post(BASE).send({ name: "Gym" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when STUDENT attempts create", async () => {
    authenticateAs(fakeStudent);

    const res = await request(app).post(BASE).send({ name: "Gym" });

    expect(res.status).toBe(403);
  });

  it("creates destination and returns 201", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "School", deletedAt: null });
    mockPrisma.destination.create.mockResolvedValue(fakeDestination);

    const res = await request(app).post(BASE).send({ name: "Library", maxOccupancy: 30 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Library");
    expect(res.body.maxOccupancy).toBe(30);
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app).post(BASE).send({ name: "Gym" });

    expect(res.status).toBe(404);
    expect(mockPrisma.destination.create).not.toHaveBeenCalled();
  });

  it("returns 400 for missing name", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post(BASE).send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid maxOccupancy", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post(BASE).send({ name: "Gym", maxOccupancy: 0 });

    expect(res.status).toBe(400);
  });
});

describe(`PATCH ${BASE}/:id`, () => {
  it("returns 404 when destination not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.destination.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`${BASE}/99999`)
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
  });

  it("updates destination and returns 200", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakeDestination, name: "Updated Library" };
    mockPrisma.destination.findFirst.mockResolvedValue(fakeDestination);
    mockPrisma.destination.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`${BASE}/1`)
      .send({ name: "Updated Library" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Library");
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).patch(`${BASE}/1`).send({});

    expect(res.status).toBe(400);
  });
});

describe(`DELETE ${BASE}/:id`, () => {
  it("soft deletes destination and returns 204", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.destination.findFirst.mockResolvedValue(fakeDestination);
    mockPrisma.destination.update.mockResolvedValue({ ...fakeDestination, deletedAt: new Date() });

    const res = await request(app).delete(`${BASE}/1`);

    expect(res.status).toBe(204);
    expect(mockPrisma.destination.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 404 when destination not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.destination.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/999`);

    expect(res.status).toBe(404);
    expect(mockPrisma.destination.update).not.toHaveBeenCalled();
  });

  it("returns 403 when STUDENT attempts delete", async () => {
    authenticateAs(fakeStudent);

    const res = await request(app).delete(`${BASE}/1`);

    expect(res.status).toBe(403);
  });
});

describe("SUPER_ADMIN write access", () => {
  it("SUPER_ADMIN can create a destination", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "School", deletedAt: null });
    mockPrisma.destination.create.mockResolvedValue(fakeDestination);

    const res = await request(app).post(BASE).send({ name: "Library", maxOccupancy: 30 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Library");
  });

  it("SUPER_ADMIN can update a destination", async () => {
    authenticateAs(fakeSuperAdmin);
    const updated = { ...fakeDestination, name: "Updated Library" };
    mockPrisma.destination.findFirst.mockResolvedValue(fakeDestination);
    mockPrisma.destination.update.mockResolvedValue(updated);

    const res = await request(app).patch(`${BASE}/1`).send({ name: "Updated Library" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Library");
  });

  it("SUPER_ADMIN can delete a destination", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.destination.findFirst.mockResolvedValue(fakeDestination);
    mockPrisma.destination.update.mockResolvedValue({ ...fakeDestination, deletedAt: new Date() });

    const res = await request(app).delete(`${BASE}/1`);

    expect(res.status).toBe(204);
  });
});
