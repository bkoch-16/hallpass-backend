import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { passStatusMock, inFlightPassStatusesMock } from "../utils/passStatusMock.js";
import { createTestServer } from "@hallpass/express-middleware";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

// The public GET route (periods) runs behind publicSchoolDataLimiter, whose
// RedisStore (rate-limit-redis) sends raw commands via redis.call. Mock the
// ioredis client so route tests don't depend on a live Redis (CI has none);
// an unmocked call rejects and the limiter fails closed with a 500.
// See publicSchoolDataLimiter.test.ts.
vi.mock("../../src/lib/redis.js", async () => {
  const { createMockRedisCall } = await import("../utils/redisMock.js");
  return { redis: { call: createMockRedisCall() } };
});

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  IN_FLIGHT_PASS_STATUSES: inFlightPassStatusesMock,
  prisma: {
    user: { findFirst: vi.fn() },
    scheduleType: { findFirst: vi.fn() },
    period: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    pass: { findFirst: vi.fn() },
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

import app from "../../src/app.js";
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
  pass: { findFirst: ReturnType<typeof vi.fn> };
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
  id: 3,
  email: "superadmin@test.com",
  name: "Super Admin",
  role: "SUPER_ADMIN",
  schoolId: null,
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
  deletedAt: null,
};

const fakePeriod = {
  id: 1,
  scheduleTypeId: 1,
  name: "Period 1",
  startTime: "08:00",
  endTime: "09:00",
  order: 0,
};

const BASE = "/api/schools/1/schedule-types/1/periods";

beforeEach(() => {
  vi.clearAllMocks();
});

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe(`GET ${BASE}`, () => {
  it("returns 401 when not authenticated and no API key", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the API key is wrong and there is no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get(BASE).set("x-api-key", "wrong-key");

    expect(res.status).toBe(401);
  });

  it("returns periods for a valid API key with no session, bypassing school scoping", async () => {
    mockGetSession.mockResolvedValue(null);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);

    const res = await request(server)
      .get("/api/schools/999/schedule-types/1/periods")
      .set("x-api-key", "test-parent-tool-api-key");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 when schedule type not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Schedule type not found" });
  });

  it("returns periods list for school member", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });

  it("returns 400 for a non-numeric :schoolId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server).get("/api/schools/abc/schedule-types/1/periods");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });

  it("returns 400 for a non-numeric :scheduleTypeId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server).get("/api/schools/1/schedule-types/abc/periods");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });
});

describe(`POST ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts create", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(server)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(403);
  });

  it("creates period and returns 201", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
    mockPrisma.period.create.mockResolvedValue(fakePeriod);

    const res = await request(server)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.startTime).toBe("08:00");
  });

  it("returns 404 when schedule type not found on create", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(server)
      .post(BASE)
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(404);
    expect(mockPrisma.period.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid time format", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(server)
      .post(BASE)
      .send({ name: "Period 1", startTime: "8:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(400);
    expect(mockPrisma.period.create).not.toHaveBeenCalled();
  });

  it("returns 400 for missing required fields", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(server).post(BASE).send({ name: "Period 1" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric :schoolId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server)
      .post("/api/schools/abc/schedule-types/1/periods")
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });

  it("returns 400 for a non-numeric :scheduleTypeId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server)
      .post("/api/schools/1/schedule-types/abc/periods")
      .send({ name: "Period 1", startTime: "08:00", endTime: "09:00", order: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });
});

describe(`PATCH ${BASE}/:id`, () => {
  it("returns 404 when period not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(null);

    const res = await request(server)
      .patch(`${BASE}/99999`)
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
  });

  it("updates period and returns 200", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakePeriod, name: "Updated Period" };
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.period.update.mockResolvedValue(updated);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ name: "Updated Period" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Period");
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(server).patch(`${BASE}/1`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric :schoolId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server)
      .patch("/api/schools/abc/schedule-types/1/periods/1")
      .send({ name: "Updated" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });

  it("returns 422 when merged startTime is not before existing endTime", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ startTime: "09:30" });

    expect(res.status).toBe(422);
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });

  it("returns 422 when merged endTime is not after existing startTime", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ endTime: "07:00" });

    expect(res.status).toBe(422);
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });

  it("returns 422 when both fields are provided out of order", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ startTime: "10:00", endTime: "09:00" });

    expect(res.status).toBe(422);
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });

  it("updates period when both fields are provided in valid order", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakePeriod, startTime: "10:00", endTime: "11:00" };
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.period.update.mockResolvedValue(updated);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ startTime: "10:00", endTime: "11:00" });

    expect(res.status).toBe(200);
    expect(mockPrisma.period.update).toHaveBeenCalled();
  });

  it("updates unrelated field when existing row already has an invalid time range", async () => {
    authenticateAs(fakeAdmin);
    const invalidPeriod = { ...fakePeriod, startTime: "10:00", endTime: "09:00" };
    const updated = { ...invalidPeriod, name: "Updated Period" };
    mockPrisma.period.findFirst.mockResolvedValue(invalidPeriod);
    mockPrisma.period.update.mockResolvedValue(updated);

    const res = await request(server)
      .patch(`${BASE}/1`)
      .send({ name: "Updated Period" });

    expect(res.status).toBe(200);
    expect(mockPrisma.period.update).toHaveBeenCalled();
  });
});

describe(`DELETE ${BASE}/:id`, () => {
  it("soft deletes period and returns 204", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.pass.findFirst.mockResolvedValue(null);
    mockPrisma.period.update.mockResolvedValue({ ...fakePeriod, deletedAt: new Date() });

    const res = await request(server).delete(`${BASE}/1`);

    expect(res.status).toBe(204);
    expect(mockPrisma.period.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("returns 404 when period not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(null);

    const res = await request(server).delete(`${BASE}/99999`);

    expect(res.status).toBe(404);
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });

  it("returns 409 and does not delete when period has in-flight passes", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.period.findFirst.mockResolvedValue(fakePeriod);
    mockPrisma.pass.findFirst.mockResolvedValue({ id: 1, status: "WAITING" });

    const res = await request(server).delete(`${BASE}/1`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Cannot delete: period has in-flight passes" });
    expect(mockPrisma.period.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric :schoolId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server).delete("/api/schools/abc/schedule-types/1/periods/1");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });
});
