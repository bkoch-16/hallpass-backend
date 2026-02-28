import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock @hallpass/db before importing app
vi.mock("@hallpass/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  Role: {
    STUDENT: "STUDENT",
    TEACHER: "TEACHER",
    ADMIN: "ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
  },
}));

// Mock @hallpass/auth before importing app
vi.mock("@hallpass/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app";
import { prisma } from "@hallpass/db";
import { auth } from "@hallpass/auth";

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

interface FakeUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

const fakeUser: FakeUser = {
  id: "user-1",
  email: "teacher@test.com",
  name: "Test Teacher",
  emailVerified: true,
  role: "TEACHER",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user, session: {} });
  mockPrisma.user.findUnique.mockResolvedValue(user);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/users/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/users/user-1");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns 401 when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("network error"));

    const res = await request(app).get("/api/users/user-1");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns user when requesting own profile", async () => {
    const student = { ...fakeUser, id: "student-1", role: "STUDENT" };
    authenticateAs(student);
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student) // requireAuth lookup
      .mockResolvedValueOnce({        // route handler lookup
        id: student.id,
        email: student.email,
        name: student.name,
        role: student.role,
        createdAt: student.createdAt,
      });

    const res = await request(app).get(`/api/users/${student.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(student.id);
  });

  it("returns 403 when student requests another user", async () => {
    const student = { ...fakeUser, id: "student-1", role: "STUDENT" };
    authenticateAs(student);

    const res = await request(app).get("/api/users/other-user");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden" });
  });

  it("returns 404 when user not found", async () => {
    authenticateAs(fakeUser);
    // First findUnique call is from requireAuth (returns the teacher)
    // Second findUnique call is from the route handler (returns null — not found)
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(fakeUser)
      .mockResolvedValueOnce(null);

    const res = await request(app).get("/api/users/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
  });
});

describe("GET /api/users/batch", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/users/batch?ids=a,b");

    expect(res.status).toBe(401);
  });

  it("returns 400 when ids query param is missing", async () => {
    authenticateAs(fakeUser);

    const res = await request(app).get("/api/users/batch");

    expect(res.status).toBe(400);
  });

  it("returns 403 when student tries batch lookup", async () => {
    const student = { ...fakeUser, id: "student-1", role: "STUDENT" };
    authenticateAs(student);

    const res = await request(app).get("/api/users/batch?ids=a,b");

    expect(res.status).toBe(403);
  });

  it("returns 400 when more than 100 IDs are provided", async () => {
    authenticateAs(fakeUser);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(",");

    const res = await request(app).get(`/api/users/batch?ids=${ids}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Too many IDs (max 100)" });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("filters out empty IDs from comma-separated list", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "a", email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() },
    ]);

    const res = await request(app).get("/api/users/batch?ids=a,,b,");

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["a", "b"] } },
      }),
    );
  });

  it("returns users for valid teacher request", async () => {
    authenticateAs(fakeUser);
    const users = [
      { id: "a", email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() },
      { id: "b", email: "b@test.com", name: "B", role: "STUDENT", createdAt: new Date() },
    ];
    mockPrisma.user.findMany.mockResolvedValue(users);

    const res = await request(app).get("/api/users/batch?ids=a,b");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe("POST /api/users", () => {
  it("returns 403 when admin tries to create a super_admin", async () => {
    const admin = { ...fakeUser, id: "admin-1", role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User", role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden" });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("allows admin to create a student", async () => {
    const admin = { ...fakeUser, id: "admin-1", role: "ADMIN" };
    authenticateAs(admin);
    const created = { id: "new-1", email: "new@test.com", name: "New User", role: "STUDENT", createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@test.com");
  });

  it("allows super_admin to create a super_admin", async () => {
    const superAdmin = { ...fakeUser, id: "sa-1", role: "SUPER_ADMIN" };
    authenticateAs(superAdmin);
    const created = { id: "new-1", email: "new@test.com", name: "New User", role: "SUPER_ADMIN", createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User", role: "SUPER_ADMIN" });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe("SUPER_ADMIN");
  });

  it("returns 403 when teacher tries to create a user", async () => {
    authenticateAs(fakeUser);

    const res = await request(app)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/users/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).patch("/api/users/user-1").send({ name: "New Name" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when body is empty", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findUnique.mockResolvedValueOnce(fakeUser);

    const res = await request(app).patch("/api/users/user-1").send({});

    expect(res.status).toBe(400);
  });

  it("updates name successfully", async () => {
    authenticateAs(fakeUser);
    const updated = { ...fakeUser, name: "New Name" };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(fakeUser)  // requireAuth
      .mockResolvedValueOnce(fakeUser); // route handler existence check
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(app).patch("/api/users/user-1").send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
  });

  it("updates email successfully", async () => {
    authenticateAs(fakeUser);
    const updated = { ...fakeUser, email: "new@test.com" };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(fakeUser)
      .mockResolvedValueOnce(fakeUser);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(app).patch("/api/users/user-1").send({ email: "new@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("new@test.com");
  });

  it("returns 403 when promoting to a role above caller", async () => {
    const admin = { ...fakeUser, id: "admin-1", role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(fakeUser);

    const res = await request(app).patch("/api/users/user-1").send({ role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows admin to promote user to admin", async () => {
    const admin = { ...fakeUser, id: "admin-1", role: "ADMIN" };
    authenticateAs(admin);
    const updated = { ...fakeUser, role: "ADMIN" };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(fakeUser);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(app).patch("/api/users/user-1").send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
  });

  it("returns 404 when user does not exist", async () => {
    const admin = { ...fakeUser, id: "admin-1", role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(admin)  // requireAuth
      .mockResolvedValueOnce(null);  // route handler existence check

    const res = await request(app).patch("/api/users/nonexistent").send({ name: "X" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
  });
});
