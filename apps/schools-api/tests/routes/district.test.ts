import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    district: {
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
  district: {
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

const fakeDistrict = {
  id: 10,
  name: "Central District",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/districts", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when ADMIN attempts list", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(403);
  });

  it("returns paginated list for SUPER_ADMIN", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findMany.mockResolvedValue([fakeDistrict]);

    const res = await request(app).get("/api/districts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(10);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns nextCursor when there are more results", async () => {
    authenticateAs(fakeSuperAdmin);
    const districts = Array.from({ length: 51 }, (_, i) => ({ ...fakeDistrict, id: i + 1 }));
    mockPrisma.district.findMany.mockResolvedValue(districts);

    const res = await request(app).get("/api/districts?limit=50");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.nextCursor).toBe("50");
  });

  it("returns 400 for invalid limit", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).get("/api/districts?limit=0");

    expect(res.status).toBe(400);
  });
});

describe("POST /api/districts", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).post("/api/districts").send({ name: "New District" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when ADMIN attempts create", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post("/api/districts").send({ name: "New District" });

    expect(res.status).toBe(403);
  });

  it("creates district and returns 201", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.create.mockResolvedValue(fakeDistrict);

    const res = await request(app).post("/api/districts").send({ name: "New District" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    expect(res.body.name).toBe("Central District");
  });

  it("returns 400 for missing name", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).post("/api/districts").send({});

    expect(res.status).toBe(400);
    expect(mockPrisma.district.create).not.toHaveBeenCalled();
  });

  it("returns 400 for empty name", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).post("/api/districts").send({ name: "" });

    expect(res.status).toBe(400);
    expect(mockPrisma.district.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/districts/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/districts/10");

    expect(res.status).toBe(401);
  });

  it("returns district for SUPER_ADMIN", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findFirst.mockResolvedValue(fakeDistrict);

    const res = await request(app).get("/api/districts/10");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  it("returns 404 when district not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findFirst.mockResolvedValue(null);

    const res = await request(app).get("/api/districts/9999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "District not found" });
  });

  it("returns 400 for non-numeric id", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).get("/api/districts/abc");

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/districts/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).patch("/api/districts/10").send({ name: "Updated" });

    expect(res.status).toBe(401);
  });

  it("updates district and returns 200", async () => {
    authenticateAs(fakeSuperAdmin);
    const updated = { ...fakeDistrict, name: "Updated District" };
    mockPrisma.district.findFirst.mockResolvedValue(fakeDistrict);
    mockPrisma.district.update.mockResolvedValue(updated);

    const res = await request(app).patch("/api/districts/10").send({ name: "Updated District" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated District");
  });

  it("returns 404 when district not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findFirst.mockResolvedValue(null);

    const res = await request(app).patch("/api/districts/9999").send({ name: "X" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(app).patch("/api/districts/10").send({});

    expect(res.status).toBe(400);
    expect(mockPrisma.district.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/districts/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).delete("/api/districts/10");

    expect(res.status).toBe(401);
  });

  it("returns 403 when ADMIN attempts delete", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).delete("/api/districts/10");

    expect(res.status).toBe(403);
  });

  it("soft deletes district and returns 204", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findFirst.mockResolvedValue(fakeDistrict);
    mockPrisma.district.update.mockResolvedValue({ ...fakeDistrict, deletedAt: new Date() });

    const res = await request(app).delete("/api/districts/10");

    expect(res.status).toBe(204);
    expect(mockPrisma.district.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 404 when district not found", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.district.findFirst.mockResolvedValue(null);

    const res = await request(app).delete("/api/districts/9999");

    expect(res.status).toBe(404);
    expect(mockPrisma.district.update).not.toHaveBeenCalled();
  });
});
