import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    scheduleType: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    schoolCalendar: { findFirst: vi.fn() },
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
  scheduleType: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  schoolCalendar: { findFirst: ReturnType<typeof vi.fn> };
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
  id: 3,
  email: "teacher@test.com",
  name: "Teacher",
  role: "TEACHER",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeWrongSchoolUser: FakeUser = {
  id: 4,
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

const fakeScheduleType = {
  id: 1,
  schoolId: 1,
  name: "A Block",
  startBuffer: 0,
  endBuffer: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/schools/:schoolId/schedule-types", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/schools/1/schedule-types");

    expect(res.status).toBe(401);
  });

  it("returns 403 when user is from a different school", async () => {
    authenticateAs(fakeWrongSchoolUser);

    const res = await request(app).get("/api/schools/1/schedule-types");

    expect(res.status).toBe(403);
  });

  it("returns schedule types list for ADMIN of the school", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findMany.mockResolvedValue([fakeScheduleType]);

    const res = await request(app).get("/api/schools/1/schedule-types");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });

  it("TEACHER of the same school can list schedule types", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.scheduleType.findMany.mockResolvedValue([fakeScheduleType]);

    const res = await request(app).get("/api/schools/1/schedule-types");

    expect(res.status).toBe(200);
  });
});

describe("POST /api/schools/:schoolId/schedule-types", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/schools/1/schedule-types")
      .send({ name: "B Block" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts create", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app)
      .post("/api/schools/1/schedule-types")
      .send({ name: "B Block" });

    expect(res.status).toBe(403);
  });

  it("creates schedule type and returns 201", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, name: "Test School", deletedAt: null });
    mockPrisma.scheduleType.create.mockResolvedValue(fakeScheduleType);

    const res = await request(app)
      .post("/api/schools/1/schedule-types")
      .send({ name: "A Block", startBuffer: 5 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("A Block");
  });

  it("returns 404 when school not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/schools/1/schedule-types")
      .send({ name: "A Block" });

    expect(res.status).toBe(404);
    expect(mockPrisma.scheduleType.create).not.toHaveBeenCalled();
  });

  it("returns 400 for missing name", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app)
      .post("/api/schools/1/schedule-types")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/schools/:schoolId/schedule-types/:id", () => {
  it("returns 404 when schedule type not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/schools/1/schedule-types/99999")
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
    expect(mockPrisma.scheduleType.update).not.toHaveBeenCalled();
  });

  it("updates schedule type and returns 200", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakeScheduleType, name: "Updated Block" };
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.scheduleType.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch("/api/schools/1/schedule-types/1")
      .send({ name: "Updated Block" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Block");
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app)
      .patch("/api/schools/1/schedule-types/1")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/schools/:schoolId/schedule-types/:id", () => {
  it("soft deletes schedule type and returns 204", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleType.update.mockResolvedValue({ ...fakeScheduleType, deletedAt: new Date() });

    const res = await request(app).delete("/api/schools/1/schedule-types/1");

    expect(res.status).toBe(204);
    expect(mockPrisma.scheduleType.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 409 when schedule type is referenced by calendar entries", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue({ id: 1, scheduleTypeId: 1 });

    const res = await request(app).delete("/api/schools/1/schedule-types/1");

    expect(res.status).toBe(409);
    expect(mockPrisma.scheduleType.update).not.toHaveBeenCalled();
  });

  it("returns 404 when schedule type not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(app).delete("/api/schools/1/schedule-types/999");

    expect(res.status).toBe(404);
  });

  it("returns 403 when TEACHER attempts delete", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app).delete("/api/schools/1/schedule-types/1");

    expect(res.status).toBe(403);
  });
});
