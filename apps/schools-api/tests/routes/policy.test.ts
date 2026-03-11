import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    passPolicy: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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
  passPolicy: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
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
  role: "ADMIN",
  schoolId: 99,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user: { id: String(user.id) }, session: {} });
  mockPrisma.user.findFirst.mockResolvedValue(user);
}

const fakePolicy = {
  id: "pol1",
  schoolId: 1,
  maxActivePasses: 5,
  interval: "DAY",
  maxPerInterval: 3,
};

const BASE = "/api/schools/1/policy";

beforeEach(() => {
  vi.clearAllMocks();
});

describe(`GET ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(401);
  });

  it("returns 403 when user is from a different school", async () => {
    authenticateAs(fakeWrongSchool);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(403);
  });

  it("returns 404 when no policy is set", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.passPolicy.findUnique.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "No policy set for this school" });
  });

  it("returns policy for school member", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.passPolicy.findUnique.mockResolvedValue(fakePolicy);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("pol1");
    expect(res.body.maxActivePasses).toBe(5);
    expect(res.body.interval).toBe("DAY");
  });
});

describe(`PUT ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).put(BASE).send({ maxActivePasses: 5 });

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts upsert", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app).put(BASE).send({ maxActivePasses: 5 });

    expect(res.status).toBe(403);
  });

  it("returns 403 when user is from a different school", async () => {
    authenticateAs(fakeWrongSchool);

    const res = await request(app).put(BASE).send({ maxActivePasses: 5 });

    expect(res.status).toBe(403);
  });

  it("upserts policy and returns 200", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "School", deletedAt: null });
    mockPrisma.passPolicy.upsert.mockResolvedValue(fakePolicy);

    const res = await request(app)
      .put(BASE)
      .send({ maxActivePasses: 5, interval: "DAY", maxPerInterval: 3 });

    expect(res.status).toBe(200);
    expect(res.body.interval).toBe("DAY");
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app).put(BASE).send({ maxActivePasses: 5 });

    expect(res.status).toBe(404);
    expect(mockPrisma.passPolicy.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when interval set without maxPerInterval", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).put(BASE).send({ interval: "DAY" });

    expect(res.status).toBe(400);
    expect(mockPrisma.passPolicy.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid interval value", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).put(BASE).send({ interval: "YEAR", maxPerInterval: 5 });

    expect(res.status).toBe(400);
  });

  it("SUPER_ADMIN can upsert policy", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "School", deletedAt: null });
    mockPrisma.passPolicy.upsert.mockResolvedValue(fakePolicy);

    const res = await request(app)
      .put(BASE)
      .send({ maxActivePasses: 5, interval: "DAY", maxPerInterval: 3 });

    expect(res.status).toBe(200);
    expect(res.body.interval).toBe("DAY");
  });

  it("accepts empty body (all nulls)", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "School", deletedAt: null });
    mockPrisma.passPolicy.upsert.mockResolvedValue({
      id: "pol1",
      schoolId: 1,
      maxActivePasses: null,
      interval: null,
      maxPerInterval: null,
    });

    const res = await request(app).put(BASE).send({});

    expect(res.status).toBe(200);
  });
});
