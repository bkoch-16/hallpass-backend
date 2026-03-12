import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    scheduleType: { findFirst: vi.fn() },
    period: {
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
  scheduleType: { findFirst: ReturnType<typeof vi.fn> };
  period: {
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

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user: { id: String(user.id) }, session: {} });
  mockPrisma.user.findFirst.mockResolvedValue(user);
}

const fakeScheduleType = {
  id: "sched1",
  schoolId: 1,
  name: "A Block",
  startBuffer: 0,
  endBuffer: 0,
  deletedAt: null,
};

const fakePeriod = {
  id: "period1",
  scheduleTypeId: "sched1",
  name: "Period 1",
  startTime: "08:00",
  endTime: "09:00",
  order: 0,
};

const BASE = "/api/schools/1/schedule-types/sched1/periods";

beforeEach(() => {
  vi.clearAllMocks();
});

describe(`GET ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(401);
  });

  it("returns 404 when schedule type not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Schedule type not found" });
  });

  it("returns periods list for school member", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("period1");
  });
});

describe(`POST ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts create", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(403);
  });

  it("creates period and returns 201", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.period.create.mockResolvedValue(fakePeriod);

    const res = await request(app)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("period1");
    expect(res.body.startTime).toBe("08:00");
  });

  it("returns 404 when schedule type not found on create", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(404);
    expect(mockPrisma.period.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid time format", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app)
      .post(BASE)
      .send({ name: "Period 1", startTime: "8:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(400);
    expect(mockPrisma.period.create).not.toHaveBeenCalled();
  });

  it("returns 400 for missing required fields", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post(BASE).send({ name: "Period 1" });

    expect(res.status).toBe(400);
  });
});

describe(`PATCH ${BASE}/:id`, () => {
  it("returns 404 when period not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`${BASE}/missing-id`)
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
  });

  it("updates period and returns 200", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakePeriod, name: "Updated Period" };
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.period.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`${BASE}/period1`)
      .send({ name: "Updated Period" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Period");
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).patch(`${BASE}/period1`).send({});

    expect(res.status).toBe(400);
  });
});

describe(`DELETE ${BASE}/:id`, () => {
  it("soft deletes period and returns 204", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.period.update.mockResolvedValue({ ...fakePeriod, deletedAt: new Date() });

    const res = await request(app).delete(`${BASE}/period1`);

    expect(res.status).toBe(204);
    expect(mockPrisma.period.update).toHaveBeenCalledWith({
      where: { id: "period1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 404 when period not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/missing`);

    expect(res.status).toBe(404);
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });
});
