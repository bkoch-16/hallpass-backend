import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    school: {
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
  school: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

interface FakeUser {
  id: number;
  email: string;
  name: string;
  role: string;
  schoolId: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const fakeSuperAdmin: FakeUser = {
  id: 1,
  email: "superadmin@test.com",
  name: "Super Admin",
  role: "SUPER_ADMIN",
  schoolId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeAdmin: FakeUser = {
  id: 2,
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user: { id: String(user.id) }, session: {} });
  mockPrisma.user.findFirst.mockResolvedValue(user);
}

const fakeSchool = {
  id: 1,
  name: "Westside High",
  timezone: "America/Los_Angeles",
  districtId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/schools", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/schools");

    expect(res.status).toBe(401);
  });

  it("returns 403 when ADMIN attempts list", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).get("/api/schools");

    expect(res.status).toBe(403);
  });

  it("returns paginated list for SUPER_ADMIN", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findMany.mockResolvedValue([fakeSchool]);

    const res = await request(app).get("/api/schools");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(1);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns nextCursor when more results exist", async () => {
    authenticateAs(fakeSuperAdmin);
    const schools = Array.from({ length: 51 }, (_, i) => ({ ...fakeSchool, id: i + 1 }));
    mockPrisma.school.findMany.mockResolvedValue(schools);

    const res = await request(app).get("/api/schools?limit=50");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.nextCursor).toBe("50");
  });
});

describe("POST /api/schools", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).post("/api/schools").send({ name: "New School" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when ADMIN attempts create", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post("/api/schools").send({ name: "New School" });

    expect(res.status).toBe(403);
  });

  it("creates school with name only and returns 201", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.create.mockResolvedValue(fakeSchool);

    const res = await request(app).post("/api/schools").send({ name: "Westside High" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.timezone).toBe("America/Los_Angeles");
  });

  it("creates school with optional timezone", async () => {
    authenticateAs(fakeSuperAdmin);
    const withTimezone = { ...fakeSchool, timezone: "America/New_York" };
    mockPrisma.school.create.mockResolvedValue(withTimezone);

    const res = await request(app)
      .post("/api/schools")
      .send({ name: "East School", timezone: "America/New_York" });

    expect(res.status).toBe(201);
    expect(res.body.timezone).toBe("America/New_York");
  });

  it("returns 400 for missing name", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).post("/api/schools").send({});

    expect(res.status).toBe(400);
    expect(mockPrisma.school.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/schools/:id", () => {
  it("returns school for SUPER_ADMIN", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);

    const res = await request(app).get("/api/schools/1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.name).toBe("Westside High");
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app).get("/api/schools/9999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "School not found" });
  });

  it("returns 403 when ADMIN attempts get by id", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).get("/api/schools/1");

    expect(res.status).toBe(403);
  });

  it("returns 400 for non-numeric id", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).get("/api/schools/abc");

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/schools/:id", () => {
  it("returns 403 when ADMIN attempts update", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).patch("/api/schools/1").send({ name: "Updated" });

    expect(res.status).toBe(403);
  });

  it("updates school and returns 200", async () => {
    authenticateAs(fakeSuperAdmin);
    const updated = { ...fakeSchool, name: "Updated School" };
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
    mockPrisma.school.update.mockResolvedValue(updated);

    const res = await request(app).patch("/api/schools/1").send({ name: "Updated School" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated School");
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app).patch("/api/schools/9999").send({ name: "X" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).patch("/api/schools/1").send({});

    expect(res.status).toBe(400);
    expect(mockPrisma.school.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/schools/:id", () => {
  it("soft deletes school and returns 204", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
    mockPrisma.school.update.mockResolvedValue({ ...fakeSchool, deletedAt: new Date() });

    const res = await request(app).delete("/api/schools/1");

    expect(res.status).toBe(204);
    expect(mockPrisma.school.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app).delete("/api/schools/9999");

    expect(res.status).toBe(404);
    expect(mockPrisma.school.update).not.toHaveBeenCalled();
  });

  it("returns 403 when ADMIN attempts delete", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).delete("/api/schools/1");

    expect(res.status).toBe(403);
  });
});
