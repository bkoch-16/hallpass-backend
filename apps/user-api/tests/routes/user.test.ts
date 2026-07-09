import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestServer } from "@hallpass/express-middleware";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

// Mock @hallpass/db before importing app
vi.mock("@hallpass/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app.js";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

interface FakeUser {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string;
  schoolId: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const fakeUser: FakeUser = {
  id: 1,
  email: "teacher@test.com",
  name: "Test Teacher",
  emailVerified: true,
  role: "TEACHER",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

interface FindFirstArgs {
  where: { id?: number; schoolId?: number | null };
  select?: Record<string, boolean>;
}

// Route-handler findFirst behavior (target-user lookups). requireAuth's own
// lookup is answered by authenticateAs based on the call's arguments, so
// tests never depend on how many times findFirst runs or in what order.
// Defaults to "not found".
let targetUserLookup: () => Promise<unknown>;

function givenTargetUser(user: unknown) {
  targetUserLookup = () => Promise.resolve(user);
}

function givenTargetUserLookupError(error: Error) {
  targetUserLookup = () => Promise.reject(error);
}

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user, session: {} });
  mockPrisma.user.findFirst.mockImplementation((args: FindFirstArgs) => {
    // requireAuth resolves the session user with
    // findFirst({ where: { id, deletedAt: null } }) — no select, no schoolId
    // scope. Route-handler lookups always differ (select and/or schoolId)
    // except self-targeted existence checks, where returning the session
    // user is correct anyway.
    const isAuthLookup =
      !args.select && args.where.id === user.id && !("schoolId" in args.where);
    return isAuthLookup ? Promise.resolve(user) : targetUserLookup();
  });
}

const { server, start, stop } = createTestServer(app);

beforeAll(start);
afterAll(stop);

beforeEach(() => {
  vi.resetAllMocks();
  targetUserLookup = () => Promise.resolve(null);
});

describe("GET /api/users/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get("/api/users/1");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns 401 when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("network error"));

    const res = await request(server).get("/api/users/1");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns user when requesting own profile", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);
    givenTargetUser({
      id: student.id,
      email: student.email,
      name: student.name,
      role: student.role,
      createdAt: student.createdAt,
    });

    const res = await request(server).get(`/api/users/${student.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(student.id);
  });

  it("returns 403 when student requests another user", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server).get("/api/users/4");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden" });
  });

  it("returns 404 when user not found", async () => {
    authenticateAs(fakeUser);
    // target lookup defaults to null — not found

    const res = await request(server).get("/api/users/9999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
  });

  it("returns 200 when teacher accesses another user's profile", async () => {
    const otherUser = { ...fakeUser, id: 4, email: "other@test.com", name: "Other User" };
    authenticateAs(fakeUser); // teacher with id 1
    givenTargetUser({
      id: otherUser.id,
      email: otherUser.email,
      name: otherUser.name,
      role: otherUser.role,
      createdAt: otherUser.createdAt,
    });

    const res = await request(server).get("/api/users/4");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(4);
  });
});

describe("GET /api/users/me", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get("/api/users/me");

    expect(res.status).toBe(401);
  });

  it("returns own profile for student", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(2);
  });

  it("returns own profile for teacher", async () => {
    authenticateAs(fakeUser);

    const res = await request(server).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fakeUser.id);
  });

  it("does not expose deletedAt or emailVerified", async () => {
    authenticateAs(fakeUser);

    const res = await request(server).get("/api/users/me");

    expect(res.body).not.toHaveProperty("deletedAt");
    expect(res.body).not.toHaveProperty("emailVerified");
  });

  it("response includes schoolId field", async () => {
    authenticateAs(fakeUser); // schoolId: 1

    const res = await request(server).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("schoolId", 1);
  });
});

describe("GET /api/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get("/api/users");

    expect(res.status).toBe(401);
  });

  it("returns 403 when student tries to list all users", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server).get("/api/users");

    expect(res.status).toBe(403);
  });

  it("returns paginated list for teacher", async () => {
    authenticateAs(fakeUser);
    const users = [
      { id: 10, email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() },
      { id: 11, email: "b@test.com", name: "B", role: "STUDENT", createdAt: new Date() },
    ];
    mockPrisma.user.findMany.mockResolvedValue(users);

    const res = await request(server).get("/api/users");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
  });

  it("filters by role", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?role=STUDENT");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "STUDENT", deletedAt: null, schoolId: 1 }),
      }),
    );
  });

  it("passes cursor and limit to prisma", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?cursor=5&limit=10");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 11,
        cursor: { id: 5 },
        skip: 1,
      }),
    );
  });

  it("returns nextCursor when more results exist", async () => {
    authenticateAs(fakeUser);
    const users = Array.from({ length: 51 }, (_, i) => ({
      id: i,
      email: `u${i}@test.com`,
      name: `User ${i}`,
      role: "STUDENT",
      createdAt: new Date(),
    }));
    mockPrisma.user.findMany.mockResolvedValue(users);

    const res = await request(server).get("/api/users?limit=50");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.nextCursor).toBe("49");
  });

  it("fetches specific users when ?ids= is provided", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 10, email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() },
    ]);

    const res = await request(server).get("/api/users?ids=10,11");

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [10, 11] }, deletedAt: null, schoolId: 1 },
      }),
    );
  });

  it("trims whitespace around ids", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?ids= 10 , 11 ");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [10, 11] }, deletedAt: null, schoolId: 1 },
      }),
    );
  });

  it("filters out empty IDs from comma-separated list", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?ids=10,,11,");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [10, 11] }, deletedAt: null, schoolId: 1 },
      }),
    );
  });

  it("scopes query to req.user.schoolId for TEACHER", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ schoolId: 1, deletedAt: null }),
      }),
    );
  });

  it("scopes ?ids= query to req.user.schoolId for TEACHER", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?ids=10,11");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ schoolId: 1 }),
      }),
    );
  });

  it("does NOT scope query for SUPER_ADMIN (all schools visible)", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN", schoolId: null };
    authenticateAs(superAdmin);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users");

    const callArg = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArg.where).not.toHaveProperty("schoolId");
  });

  it("does NOT scope ?ids= query for SUPER_ADMIN", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN", schoolId: null };
    authenticateAs(superAdmin);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await request(server).get("/api/users?ids=10,11");

    const callArg = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArg.where).not.toHaveProperty("schoolId");
  });

  it("returns 400 when more than 100 ids provided", async () => {
    authenticateAs(fakeUser);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(",");

    const res = await request(server).get(`/api/users?ids=${ids}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Too many IDs (max 100)" });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/users", () => {
  it("returns 403 when admin tries to create a super_admin", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User", role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden" });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("allows admin to create a student", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    const created = { id: 10, email: "new@test.com", name: "New User", role: "STUDENT", createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@test.com");
  });

  it("scopes created user to admin's schoolId", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN", schoolId: 1 };
    authenticateAs(admin);
    const created = { id: 10, email: "new@test.com", name: "New User", role: "STUDENT", schoolId: 1, createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    await request(server).post("/api/users").send({ email: "new@test.com", name: "New User" });

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ schoolId: 1 }),
      }),
    );
  });

  it("does not force schoolId when super_admin creates a user", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN", schoolId: null };
    authenticateAs(superAdmin);
    const created = { id: 10, email: "new@test.com", name: "New User", role: "STUDENT", schoolId: null, createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    await request(server).post("/api/users").send({ email: "new@test.com", name: "New User" });

    const callArg = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArg.data).not.toHaveProperty("schoolId");
  });

  it("allows super_admin to create a super_admin", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    authenticateAs(superAdmin);
    const created = { id: 10, email: "new@test.com", name: "New User", role: "SUPER_ADMIN", createdAt: new Date() };
    mockPrisma.user.create.mockResolvedValue(created);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User", role: "SUPER_ADMIN" });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe("SUPER_ADMIN");
  });

  it("returns 403 when teacher tries to create a user", async () => {
    authenticateAs(fakeUser);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when student tries to create a user", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/users/bulk", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A" }]);

    expect(res.status).toBe(401);
  });

  it("returns 403 when teacher tries to bulk create", async () => {
    authenticateAs(fakeUser);

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A" }]);

    expect(res.status).toBe(403);
  });

  it("returns 400 for empty array", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server).post("/api/users/bulk").send([]);

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 400 when body contains an invalid user", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "not-an-email", name: "A" }]);

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 403 when trying to create a user with a higher role", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A", role: "SUPER_ADMIN" }]);

    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("creates all users and returns created count", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.create
      .mockResolvedValueOnce({ id: 10, email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() })
      .mockResolvedValueOnce({ id: 11, email: "b@test.com", name: "B", role: "STUDENT", createdAt: new Date() });

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A" }, { email: "b@test.com", name: "B" }]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 2, failed: [] });
  });

  it("scopes bulk created users to admin's schoolId", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN", schoolId: 1 };
    authenticateAs(admin);
    mockPrisma.user.create
      .mockResolvedValueOnce({ id: 10, email: "a@test.com", name: "A", role: "STUDENT", schoolId: 1, createdAt: new Date() })
      .mockResolvedValueOnce({ id: 11, email: "b@test.com", name: "B", role: "STUDENT", schoolId: 1, createdAt: new Date() });

    await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A" }, { email: "b@test.com", name: "B" }]);

    for (const call of mockPrisma.user.create.mock.calls) {
      const arg = call[0] as { data: Record<string, unknown> };
      expect(arg.data).toMatchObject({ schoolId: 1 });
    }
  });

  it("returns partial success when some users fail to create", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.create
      .mockResolvedValueOnce({ id: 10, email: "a@test.com", name: "A", role: "STUDENT", createdAt: new Date() })
      .mockRejectedValueOnce(new Error("Unique constraint"));

    const res = await request(server)
      .post("/api/users/bulk")
      .send([{ email: "a@test.com", name: "A" }, { email: "dup@test.com", name: "Dup" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0]).toMatchObject({ index: 1, email: "dup@test.com" });
  });

  it("returns 400 when all users fail to create", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.create.mockRejectedValue(new Error("DB error"));

    const res = await request(server)
      .post("/api/users/bulk")
      .send([
        { email: "a@test.com", name: "A" },
        { email: "b@test.com", name: "B" },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.created).toBe(0);
    expect(res.body.failed).toHaveLength(2);
  });


  it("returns 400 when email is missing", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users")
      .send({ name: "New User" });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 400 when email is invalid format", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "not-an-email", name: "New User" });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "valid@test.com" });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 when email already exists (unique constraint violation)", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockPrisma.user.create.mockRejectedValue(error);

    const res = await request(server)
      .post("/api/users")
      .send({ email: "dup@test.com", name: "Dup User" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Email already in use" });
  });

  it("returns 500 when prisma.user.create throws an unexpected error", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    mockPrisma.user.create.mockRejectedValue(new Error("unexpected DB error"));

    const res = await request(server)
      .post("/api/users")
      .send({ email: "new@test.com", name: "New User" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});

describe("PATCH /api/users/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).patch("/api/users/1").send({ name: "New Name" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when body is empty", async () => {
    authenticateAs(fakeUser);

    const res = await request(server).patch("/api/users/1").send({});

    expect(res.status).toBe(400);
  });

  it("updates name successfully", async () => {
    authenticateAs(fakeUser);
    const updated = { ...fakeUser, name: "New Name" };
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(server).patch("/api/users/1").send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
  });

  it("updates email successfully when caller is admin", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const target = { ...fakeUser, id: 6, role: "STUDENT" };
    authenticateAs(admin);
    const updated = { ...target, email: "new@test.com" };
    givenTargetUser(target);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(server).patch("/api/users/6").send({ email: "new@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("new@test.com");
  });

  it("returns 403 when promoting to a role above caller", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUser(fakeUser);

    const res = await request(server).patch("/api/users/1").send({ role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows admin to promote user to admin", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    const updated = { ...fakeUser, role: "ADMIN" };
    givenTargetUser(fakeUser);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(server).patch("/api/users/1").send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
  });

  it("returns 403 when ADMIN tries to change a peer ADMIN's email", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const peer = { ...fakeUser, id: 6, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUser(peer);

    const res = await request(server).patch("/api/users/6").send({ email: "hijack@test.com" });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when ADMIN tries to demote a peer ADMIN", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const peer = { ...fakeUser, id: 6, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUser(peer);

    const res = await request(server).patch("/api/users/6").send({ role: "STUDENT" });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows SUPER_ADMIN to edit an ADMIN", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    const target = { ...fakeUser, id: 6, role: "ADMIN" };
    authenticateAs(superAdmin);
    givenTargetUser(target);
    mockPrisma.user.update.mockResolvedValue({ ...target, name: "Renamed" });

    const res = await request(server).patch("/api/users/6").send({ name: "Renamed" });

    expect(res.status).toBe(200);
  });

  it("returns 404 when user does not exist", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    // target lookup defaults to null — not found

    const res = await request(server).patch("/api/users/9999").send({ name: "X" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
  });

  it("returns 400 when PATCH body has invalid email format", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server).patch("/api/users/2").send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 400 when PATCH body has empty name", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server).patch("/api/users/2").send({ name: "" });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 200 when student updates their own name", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);
    const updated = { ...student, name: "Updated Name" };
    // self-targeted existence check is answered by authenticateAs
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(server).patch("/api/users/2").send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("returns 403 when student tries to update their own email", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server).patch("/api/users/2").send({ email: "new@student.com" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when student tries to change their own role", async () => {
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(student);

    const res = await request(server).patch("/api/users/2").send({ role: "TEACHER" });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when teacher updates another user", async () => {
    authenticateAs(fakeUser); // teacher with id 1

    const res = await request(server).patch("/api/users/4").send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when TEACHER tries to change schoolId", async () => {
    authenticateAs(fakeUser); // teacher with id 1

    const res = await request(server).patch("/api/users/1").send({ schoolId: 2 });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when ADMIN tries to change schoolId", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);

    const res = await request(server).patch("/api/users/2").send({ schoolId: 2 });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 404 when ADMIN tries to update a user from a different school", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN", schoolId: 1 };
    authenticateAs(admin);
    // target lookup defaults to null — schoolId scoping excludes the cross-school user

    const res = await request(server).patch("/api/users/99").send({ name: "Hijack" });

    expect(res.status).toBe(404);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows SUPER_ADMIN to change schoolId", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    const target = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(superAdmin);
    const updated = { ...target, schoolId: 2 };
    givenTargetUser(target);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await request(server).patch("/api/users/2").send({ schoolId: 2 });

    expect(res.status).toBe(200);
  });

});

describe("DELETE /api/users/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).delete("/api/users/1");

    expect(res.status).toBe(401);
  });

  it("returns 403 when teacher tries to delete a user", async () => {
    authenticateAs(fakeUser);

    const res = await request(server).delete("/api/users/2");

    expect(res.status).toBe(403);
  });

  it("returns 404 when user does not exist", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    // target lookup defaults to null — not found

    const res = await request(server).delete("/api/users/9999");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
  });

  it("returns 403 when admin tries to delete another admin", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const otherAdmin = { ...fakeUser, id: 7, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUser(otherAdmin);

    const res = await request(server).delete("/api/users/7");

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when admin tries to delete a super_admin", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    authenticateAs(admin);
    givenTargetUser(superAdmin);

    const res = await request(server).delete("/api/users/5");

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows admin to delete a student (soft delete)", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(admin);
    givenTargetUser(student);
    mockPrisma.user.update.mockResolvedValue({ ...student, deletedAt: new Date() });

    const res = await request(server).delete("/api/users/2");

    expect(res.status).toBe(204);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("allows super_admin to delete an admin (soft delete)", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(superAdmin);
    givenTargetUser(admin);
    mockPrisma.user.update.mockResolvedValue({ ...admin, deletedAt: new Date() });

    const res = await request(server).delete("/api/users/3");

    expect(res.status).toBe(204);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 403 when admin tries to delete themselves", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUser(admin); // target is themselves

    const res = await request(server).delete("/api/users/3");

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when super_admin tries to delete themselves", async () => {
    const superAdmin = { ...fakeUser, id: 5, role: "SUPER_ADMIN" };
    authenticateAs(superAdmin);
    // self-targeted existence check is answered by authenticateAs

    const res = await request(server).delete("/api/users/5");

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("DB error handling", () => {
  it("GET /api/users/:id returns 500 when prisma throws", async () => {
    authenticateAs(fakeUser);
    givenTargetUserLookupError(new Error("DB error"));

    const res = await request(server).get("/api/users/1");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("GET /api/users returns 500 when prisma throws", async () => {
    authenticateAs(fakeUser);
    mockPrisma.user.findMany.mockRejectedValue(new Error("DB error"));

    const res = await request(server).get("/api/users");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("PATCH /api/users/:id returns 500 when prisma.findFirst throws on existence check", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    authenticateAs(admin);
    givenTargetUserLookupError(new Error("DB error")); // existence check

    const res = await request(server).patch("/api/users/2").send({ name: "X" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("PATCH /api/users/:id returns 500 when prisma.update throws", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(admin);
    givenTargetUser(student);
    mockPrisma.user.update.mockRejectedValue(new Error("DB error"));

    const res = await request(server).patch("/api/users/2").send({ name: "X" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("DELETE /api/users/:id returns 500 when prisma.update throws", async () => {
    const admin = { ...fakeUser, id: 3, role: "ADMIN" };
    const student = { ...fakeUser, id: 2, role: "STUDENT" };
    authenticateAs(admin);
    givenTargetUser(student);
    mockPrisma.user.update.mockRejectedValue(new Error("DB error"));

    const res = await request(server).delete("/api/users/2");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});
