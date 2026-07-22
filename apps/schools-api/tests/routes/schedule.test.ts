import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestServer } from "@hallpass/express-middleware";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    schoolCalendar: { findFirst: vi.fn() },
    scheduleType: { findFirst: vi.fn() },
    period: { findMany: vi.fn() },
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
  school: { findFirst: ReturnType<typeof vi.fn> };
  schoolCalendar: { findFirst: ReturnType<typeof vi.fn> };
  scheduleType: { findFirst: ReturnType<typeof vi.fn> };
  period: { findMany: ReturnType<typeof vi.fn> };
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

const fakeTeacher: FakeUser = {
  id: 1,
  email: "teacher@test.com",
  name: "Teacher",
  role: "TEACHER",
  schoolId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeWrongSchool: FakeUser = {
  id: 2,
  email: "other@test.com",
  name: "Other",
  role: "STUDENT",
  schoolId: 99,
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

const fakeSchool = { timezone: "UTC" };

const fakeScheduleType = {
  id: 10,
  schoolId: 1,
  name: "Standard Day",
  startBuffer: 0,
  endBuffer: 0,
};

const BASE = "/api/schools/1/schedule";

beforeEach(() => {
  vi.clearAllMocks();
});

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe(`GET ${BASE}/today`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a user from another school", async () => {
    authenticateAs(fakeWrongSchool);

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-numeric :schoolId", async () => {
    authenticateAs(fakeSuperAdmin);

    const res = await request(server).get("/api/schools/abc/schedule/today");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "Invalid params",
      errors: expect.anything(),
    });
  });

  it("returns 404 when the school does not exist", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "School not found" });
  });

  it("200 with an empty schedule when no calendar entry exists for today", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(200);
    expect(res.body.scheduleType).toBeNull();
    expect(res.body.periods).toEqual([]);
    expect(res.body.currentPeriod).toBeNull();
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockPrisma.scheduleType.findFirst).not.toHaveBeenCalled();
  });

  it("200 with an empty schedule when the calendar entry has no scheduleTypeId", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue({
      id: 1,
      schoolId: 1,
      date: new Date(),
      scheduleTypeId: null,
      note: null,
    });

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(200);
    expect(res.body.scheduleType).toBeNull();
    expect(res.body.periods).toEqual([]);
    expect(res.body.currentPeriod).toBeNull();
  });

  it("returns the current period when now falls inside a period's window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T09:30:00Z")); // 09:30 UTC, school timezone is UTC
    try {
      authenticateAs(fakeTeacher);
      mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
      mockPrisma.schoolCalendar.findFirst.mockResolvedValue({
        id: 1,
        schoolId: 1,
        date: new Date("2026-07-21T00:00:00Z"),
        scheduleTypeId: 10,
        note: null,
      });
      mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
      mockPrisma.period.findMany.mockResolvedValue([
        {
          id: 1,
          scheduleTypeId: 10,
          name: "Period 1",
          startTime: "09:00",
          endTime: "10:00",
          order: 0,
        },
      ]);

      const res = await request(server).get(`${BASE}/today`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe("2026-07-21");
      expect(res.body.scheduleType).toEqual(fakeScheduleType);
      expect(res.body.currentPeriod).toMatchObject({
        id: 1,
        name: "Period 1",
        windowStart: "09:00",
        windowEnd: "10:00",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns currentPeriod null when now falls between two periods", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T09:30:00Z")); // 09:30 UTC — between the two periods below
    try {
      authenticateAs(fakeTeacher);
      mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
      mockPrisma.schoolCalendar.findFirst.mockResolvedValue({
        id: 1,
        schoolId: 1,
        date: new Date("2026-07-21T00:00:00Z"),
        scheduleTypeId: 10,
        note: null,
      });
      mockPrisma.scheduleType.findFirst.mockResolvedValue(fakeScheduleType);
      mockPrisma.period.findMany.mockResolvedValue([
        {
          id: 1,
          scheduleTypeId: 10,
          name: "Period 1",
          startTime: "08:00",
          endTime: "09:00",
          order: 0,
        },
        {
          id: 2,
          scheduleTypeId: 10,
          name: "Period 2",
          startTime: "10:00",
          endTime: "11:00",
          order: 1,
        },
      ]);

      const res = await request(server).get(`${BASE}/today`);

      expect(res.status).toBe(200);
      expect(res.body.periods).toHaveLength(2);
      expect(res.body.currentPeriod).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("SUPER_ADMIN can access any school's schedule", async () => {
    authenticateAs(fakeSuperAdmin);
    mockPrisma.school.findFirst.mockResolvedValue(fakeSchool);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/today`);

    expect(res.status).toBe(200);
  });
});
