import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { passStatusMock } from "../utils/passStatusMock.js";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: {
    user: { findFirst: vi.fn() },
    school: { findFirst: vi.fn() },
    schoolCalendar: { findFirst: vi.fn() },
    period: { findFirst: vi.fn(), findMany: vi.fn() },
    passPolicy: { findFirst: vi.fn() },
    destination: { findUnique: vi.fn(), findFirst: vi.fn() },
    pass: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../../src/lib/slots.js", () => ({
  claimPassSlots: vi.fn().mockResolvedValue("claimed"),
  releasePassSlots: vi.fn().mockResolvedValue(undefined),
  releaseAndPromote: vi.fn().mockResolvedValue(undefined),
  getMaxActivePasses: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../../src/lib/expiry.js", () => ({
  scheduleLocalExpiry: vi.fn(),
  expirePass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app";
import { createTestServer } from "@hallpass/express-middleware";
import { prisma } from "@hallpass/db";
import * as slotsModule from "../../src/lib/slots.js";
import { emitPassEvent } from "../../src/lib/socket.js";

const mockEmitPassEvent = emitPassEvent as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
  school: { findFirst: ReturnType<typeof vi.fn> };
  schoolCalendar: { findFirst: ReturnType<typeof vi.fn> };
  period: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  passPolicy: { findFirst: ReturnType<typeof vi.fn> };
  destination: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  pass: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

const mockSlots = slotsModule as unknown as {
  claimPassSlots: ReturnType<typeof vi.fn>;
  releasePassSlots: ReturnType<typeof vi.fn>;
  releaseAndPromote: ReturnType<typeof vi.fn>;
  getMaxActivePasses: ReturnType<typeof vi.fn>;
};


interface FakeUser {
  id: number;
  email: string;
  name: string;
  role: string;
  schoolId: number | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const fakeStudent: FakeUser = {
  id: 10,
  email: "student@test.com",
  name: "Student",
  role: "STUDENT",
  schoolId: 1,
  emailVerified: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeTeacher: FakeUser = {
  id: 20,
  email: "teacher@test.com",
  name: "Teacher",
  role: "TEACHER",
  schoolId: 1,
  emailVerified: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeAdmin: FakeUser = {
  id: 30,
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN",
  schoolId: 1,
  emailVerified: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const fakeOtherStudent: FakeUser = {
  id: 11,
  email: "other@test.com",
  name: "Other Student",
  role: "STUDENT",
  schoolId: 1,
  emailVerified: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

function authenticateAs(user: FakeUser) {
  mockGetSession.mockResolvedValue({ user: { id: String(user.id) }, session: {} });
  mockPrisma.user.findFirst.mockResolvedValue(user);
}

// A pass at 08:30 UTC (within common school hours)
const fakeCalendar = {
  id: 1,
  schoolId: 1,
  date: new Date("2025-09-15"),
  scheduleTypeId: 5,
  note: null,
};

// Period with scheduleType included (route uses findMany with include)
// startTime "00:00" / endTime "23:59" so it's always "active" in tests
const fakePeriod = {
  id: 2,
  schoolId: 1,
  scheduleTypeId: 5,
  name: "Period 1",
  startTime: "00:00",
  endTime: "23:59",
  order: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
  scheduleType: { id: 5, schoolId: 1, name: "Regular", startBuffer: 0, endBuffer: 0 },
};

const fakePass = {
  id: 100,
  schoolId: 1,
  studentId: 10,
  requesterId: 10,
  destinationId: 1,
  periodId: 2,
  approverId: null,
  denierId: null,
  cancellerId: null,
  status: "PENDING",
  note: null,
  approverNote: null,
  denierNote: null,
  requestedAt: new Date("2025-09-15T08:30:00Z"),
  approvedAt: null,
  activatedAt: null,
  returnedAt: null,
  cancelledAt: null,
  deniedAt: null,
  expiredAt: null,
  destination: { maxOccupancy: 10 },
};

const BASE = "/api/passes";

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── POST /passes ──────────────────────────────────────────────────────────────

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe("POST /api/passes", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(401);
  });

  it("creates a pass and returns 201", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue(null);
    mockPrisma.destination.findFirst.mockResolvedValue({ id: 1, schoolId: 1, maxOccupancy: 10, deletedAt: null });
    mockPrisma.pass.create.mockResolvedValue(fakePass);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(100);
    expect(res.body.status).toBe("PENDING");
    // Ordered so overlapping buffer windows resolve to the earliest period deterministically
    expect(mockPrisma.period.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startTime: "asc" } }),
    );
  });

  it("returns 422 when destination does not belong to school", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue(null);
    mockPrisma.destination.findFirst.mockResolvedValue(null);

    const res = await request(server).post(BASE).send({ destinationId: 99 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Destination not found");
  });

  it("returns 422 when the user's school does not exist", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue(null);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("School not found");
  });

  it("returns 422 when no calendar entry for today", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("No active period");
  });

  it("returns 422 when calendar has null scheduleTypeId", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue({ ...fakeCalendar, scheduleTypeId: null });

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("No active period");
  });

  it("returns 422 when no active period found", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([]);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("No active period");
  });

  it("returns 422 when pass limit reached", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue({
      id: 1,
      schoolId: 1,
      maxActivePasses: null,
      interval: "DAY",
      maxPerInterval: 3,
    });
    mockPrisma.pass.count.mockResolvedValue(3);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Pass limit reached");
  });

  it("returns 400 for missing destinationId", async () => {
    authenticateAs(fakeStudent);

    const res = await request(server).post(BASE).send({});

    expect(res.status).toBe(400);
  });

  it("ignores studentId from a STUDENT caller — pass is created for self, PENDING", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue(null);
    mockPrisma.destination.findFirst.mockResolvedValue({ id: 1, schoolId: 1, maxOccupancy: 10, deletedAt: null });
    mockPrisma.pass.create.mockResolvedValue(fakePass);

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 99 });

    expect(res.status).toBe(201);
    expect(mockPrisma.pass.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: fakeStudent.id,
          requesterId: fakeStudent.id,
          status: "PENDING",
        }),
      }),
    );
    expect(mockSlots.claimPassSlots).not.toHaveBeenCalled();
  });
});

// ─── POST /passes — midnight window clamp ─────────────────────────────────────

describe("POST /api/passes — midnight window clamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Period starting 00:05 with a 10-minute start buffer: the buffered window
  // start must clamp to "00:00", not wrap to "23:55" (which made the window
  // never match and rejected the pass with "No active period").
  const midnightPeriod = {
    ...fakePeriod,
    id: 3,
    startTime: "00:05",
    endTime: "00:50",
    scheduleType: { id: 5, schoolId: 1, name: "Regular", startBuffer: 10, endBuffer: 0 },
  };

  it("allows a pass at 00:02 for a period starting 00:05 with a 10-minute start buffer", async () => {
    // Only fake Date — supertest needs real timers
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-09-15T00:02:00Z"));
    authenticateAs(fakeStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([midnightPeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue(null);
    mockPrisma.destination.findFirst.mockResolvedValue({ id: 1, schoolId: 1, maxOccupancy: 10, deletedAt: null });
    mockPrisma.pass.create.mockResolvedValue({ ...fakePass, periodId: 3 });

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    // Old wrapping behavior yielded windowStart "23:55" and a 422 "No active period"
    expect(res.status).toBe(201);
    expect(mockPrisma.pass.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ periodId: 3 }),
      }),
    );
  });
});

// ─── POST /passes — teacher-created ───────────────────────────────────────────

describe("POST /api/passes — teacher-created", () => {
  // requireAuth resolves the caller; the route then looks up the target student
  function authenticateTeacherWithTarget(target: FakeUser | null) {
    authenticateAs(fakeTeacher);
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(fakeTeacher)
      .mockResolvedValueOnce(target);
  }

  function mockActivePeriodAndDestination() {
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue(null);
    mockPrisma.destination.findFirst.mockResolvedValue({ id: 1, schoolId: 1, maxOccupancy: 10, deletedAt: null });
  }

  const teacherCreatedPass = {
    ...fakePass,
    id: 101,
    studentId: 11,
    requesterId: 20,
    approverId: 20,
    status: "ACTIVE",
    approvedAt: new Date("2025-09-15T08:30:00Z"),
    activatedAt: new Date("2025-09-15T08:30:00Z"),
  };

  it("TEACHER creates a pass for a student — auto-approved to ACTIVE", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockActivePeriodAndDestination();
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    mockPrisma.pass.create.mockResolvedValue(teacherCreatedPass);

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.studentId).toBe(11);
    expect(res.body.requesterId).toBe(20);
    expect(res.body.approverId).toBe(20);
    expect(mockPrisma.pass.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: 11,
          requesterId: 20,
          approverId: 20,
          status: "ACTIVE",
          approvedAt: expect.any(Date),
          activatedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockEmitPassEvent).toHaveBeenCalledWith(teacherCreatedPass, "pass:approved");
  });

  it("TEACHER creates when the destination is full — pass lands WAITING", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockActivePeriodAndDestination();
    mockSlots.claimPassSlots.mockResolvedValue("destination_full");
    const waitingPass = { ...teacherCreatedPass, status: "WAITING", activatedAt: null };
    mockPrisma.pass.create.mockResolvedValue(waitingPass);

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("WAITING");
    const createData = mockPrisma.pass.create.mock.calls[0][0].data;
    expect(createData.status).toBe("WAITING");
    expect(createData.activatedAt).toBeUndefined();
    expect(mockEmitPassEvent).toHaveBeenCalledWith(waitingPass, "pass:waiting");
  });

  it("returns 400 when TEACHER omits studentId", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);

    const res = await request(server).post(BASE).send({ destinationId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("studentId is required");
  });

  it("returns 422 when the target student is not found", async () => {
    authenticateTeacherWithTarget(null);
    mockActivePeriodAndDestination();

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 99 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Student not found");
    // Target lookup must be scoped to STUDENTs of the caller's school
    expect(mockPrisma.user.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 99, schoolId: 1, role: "STUDENT", deletedAt: null }),
      }),
    );
  });

  it("charges the quota to the target student, not the teacher", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockPrisma.school.findFirst.mockResolvedValue({ id: 1, timezone: "UTC" });
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeCalendar);
    mockPrisma.period.findMany.mockResolvedValue([fakePeriod]);
    mockPrisma.passPolicy.findFirst.mockResolvedValue({
      id: 1,
      schoolId: 1,
      maxActivePasses: null,
      interval: "DAY",
      maxPerInterval: 3,
    });
    mockPrisma.pass.count.mockResolvedValue(3);

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Pass limit reached");
    expect(mockPrisma.pass.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: 11 }),
      }),
    );
  });

  it("returns 409 and releases the claimed slot when the target already has an active pass", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockActivePeriodAndDestination();
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    mockPrisma.pass.create.mockRejectedValue({ code: "P2002" });

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Active pass already exists");
    expect(mockSlots.releasePassSlots).toHaveBeenCalledWith(1, null, 1, 10);
  });

  it("does not release a slot on conflict when none was claimed (WAITING path)", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockActivePeriodAndDestination();
    mockSlots.claimPassSlots.mockResolvedValue("destination_full");
    mockPrisma.pass.create.mockRejectedValue({ code: "P2002" });

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(409);
    expect(mockSlots.releasePassSlots).not.toHaveBeenCalled();
  });

  it("passes the policy's maxActivePasses into the slot claim", async () => {
    authenticateTeacherWithTarget(fakeOtherStudent);
    mockActivePeriodAndDestination();
    mockPrisma.passPolicy.findFirst.mockResolvedValue({
      id: 1,
      schoolId: 1,
      interval: null,
      maxPerInterval: null,
      maxActivePasses: 5,
    });
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    mockPrisma.pass.create.mockResolvedValue(teacherCreatedPass);

    const res = await request(server).post(BASE).send({ destinationId: 1, studentId: 11 });

    expect(res.status).toBe(201);
    expect(mockSlots.claimPassSlots).toHaveBeenCalledWith(1, 5, 1, 10);
  });
});

// ─── GET /passes ───────────────────────────────────────────────────────────────

describe("GET /api/passes", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(401);
  });

  it("STUDENT sees only their own passes", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findMany.mockResolvedValue([fakePass]);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].studentId).toBe(10);
    expect(res.body.nextCursor).toBeNull();
  });

  it("TEACHER sees all passes for the school", async () => {
    authenticateAs(fakeTeacher);
    const passes = [fakePass, { ...fakePass, id: 101, studentId: 11 }];
    mockPrisma.pass.findMany.mockResolvedValue(passes);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("ADMIN sees all passes for the school", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.pass.findMany.mockResolvedValue([fakePass]);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(200);
  });

  it("filters by status when query param is provided", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findMany.mockResolvedValue([fakePass]);

    const res = await request(server).get(`${BASE}?status=PENDING`);

    expect(res.status).toBe(200);
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("returns 400 for invalid status query param", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(server).get(`${BASE}?status=INVALID`);

    expect(res.status).toBe(400);
  });

  it("orders newest-first (id desc)", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findMany.mockResolvedValue([fakePass]);

    const res = await request(server).get(BASE);

    expect(res.status).toBe(200);
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: "desc" } }),
    );
  });

  it("returns nextCursor (the lowest returned id) when more results exist", async () => {
    authenticateAs(fakeTeacher);
    // limit=2 with take: 3 — prisma returns 3 rows (newest-first), so there is
    // a next page. The cursor is the last (lowest) returned id.
    const passes = [{ ...fakePass, id: 102 }, { ...fakePass, id: 101 }, fakePass];
    mockPrisma.pass.findMany.mockResolvedValue(passes);

    const res = await request(server).get(`${BASE}?limit=2`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(102);
    expect(res.body.data[1].id).toBe(101);
    expect(res.body.nextCursor).toBe("101");
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: { id: "desc" } }),
    );
  });

  it("continues from the cursor walking ids descending", async () => {
    authenticateAs(fakeTeacher);
    // Second page: ids below the cursor, still newest-first.
    mockPrisma.pass.findMany.mockResolvedValue([fakePass]);

    const res = await request(server).get(`${BASE}?cursor=101`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(100);
    expect(res.body.nextCursor).toBeNull();
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 101 },
        skip: 1,
        orderBy: { id: "desc" },
      }),
    );
  });

  it("returns 400 for invalid cursor or limit", async () => {
    authenticateAs(fakeTeacher);

    expect((await request(server).get(`${BASE}?cursor=abc`)).status).toBe(400);
    expect((await request(server).get(`${BASE}?limit=0`)).status).toBe(400);
    expect((await request(server).get(`${BASE}?limit=101`)).status).toBe(400);
  });
});

// ─── GET /passes/:id ──────────────────────────────────────────────────────────

describe("GET /api/passes/:id", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/100`);

    expect(res.status).toBe(401);
  });

  it("STUDENT can fetch their own pass", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);

    const res = await request(server).get(`${BASE}/100`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(100);
  });

  it("STUDENT gets 404 when trying to access another student's pass", async () => {
    authenticateAs(fakeOtherStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/100`);

    expect(res.status).toBe(404);
  });

  it("TEACHER can fetch any pass in their school", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);

    const res = await request(server).get(`${BASE}/100`);

    expect(res.status).toBe(200);
  });

  it("returns 404 when pass does not exist", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).get(`${BASE}/9999`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for non-numeric id", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(server).get(`${BASE}/abc`);

    expect(res.status).toBe(400);
  });
});

// ─── POST /passes/:id/approve ─────────────────────────────────────────────────

describe("POST /api/passes/:id/approve", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(401);
  });

  it("returns 403 when STUDENT attempts to approve", async () => {
    authenticateAs(fakeStudent);

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(403);
  });

  it("TEACHER can approve a PENDING pass — slot available → ACTIVE", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    const approvedPass = {
      ...fakePass,
      status: "ACTIVE",
      approverId: 20,
      approvedAt: new Date(),
    };
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(approvedPass);

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.approverId).toBe(20);
  });

  it("TEACHER approves but no slot available → pass becomes WAITING", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockSlots.claimPassSlots.mockResolvedValue("destination_full");
    const waitingPass = {
      ...fakePass,
      status: "WAITING",
      approverId: 20,
      approvedAt: new Date(),
    };
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(waitingPass);

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("WAITING");
  });

  it("ADMIN can approve a PENDING pass", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({ ...fakePass, status: "ACTIVE", approverId: 30, approvedAt: new Date() });

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
  });

  it("returns 409 and releases the slot when the pass was transitioned concurrently", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockSlots.getMaxActivePasses.mockResolvedValue(null);
    mockSlots.claimPassSlots.mockResolvedValue("claimed");
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(409);
    expect(mockSlots.releasePassSlots).toHaveBeenCalledWith(
      1,
      null,
      fakePass.destinationId,
      fakePass.destination.maxOccupancy,
    );
  });

  it("returns WAITING when the school-wide active-pass cap is reached even though the destination has room", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockSlots.getMaxActivePasses.mockResolvedValue(5);
    // Destination has room, but claimPassSlots reports failure (school cap exhausted)
    mockSlots.claimPassSlots.mockResolvedValue("school_full");
    const waitingPass = {
      ...fakePass,
      status: "WAITING",
      approverId: 20,
      approvedAt: new Date(),
    };
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(waitingPass);

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("WAITING");
    expect(mockEmitPassEvent).toHaveBeenCalledWith(waitingPass, "pass:waiting");
    expect(mockSlots.claimPassSlots).toHaveBeenCalledWith(
      1,
      5,
      fakePass.destinationId,
      fakePass.destination.maxOccupancy,
    );
  });

  it("returns 409 without releasing a slot when no slot was claimed (WAITING path)", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockSlots.claimPassSlots.mockResolvedValue("destination_full");
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(409);
    expect(mockSlots.releasePassSlots).not.toHaveBeenCalled();
  });

  it("returns 400 when pass is not PENDING", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });

    const res = await request(server).post(`${BASE}/100/approve`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when pass not found", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/9999/approve`).send({});

    expect(res.status).toBe(404);
  });
});

// ─── POST /passes/:id/deny ────────────────────────────────────────────────────

describe("POST /api/passes/:id/deny", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/deny`).send({});

    expect(res.status).toBe(401);
  });

  it("returns 403 when STUDENT attempts to deny", async () => {
    authenticateAs(fakeStudent);

    const res = await request(server).post(`${BASE}/100/deny`).send({});

    expect(res.status).toBe(403);
  });

  it("TEACHER can deny a PENDING pass", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    const deniedPass = {
      ...fakePass,
      status: "DENIED",
      denierId: 20,
      deniedAt: new Date(),
    };
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(deniedPass);

    const res = await request(server).post(`${BASE}/100/deny`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DENIED");
  });

  it("stores the denial reason in denierNote, not approverNote", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "DENIED",
      denierId: 20,
      deniedAt: new Date(),
      denierNote: "Hall is closed",
    });

    const res = await request(server)
      .post(`${BASE}/100/deny`)
      .send({ denierNote: "Hall is closed" });

    expect(res.status).toBe(200);
    expect(res.body.denierNote).toBe("Hall is closed");
    const updateData = mockPrisma.pass.updateMany.mock.calls[0][0].data;
    expect(updateData.denierNote).toBe("Hall is closed");
    expect(updateData.approverNote).toBeUndefined();
  });

  it("returns 400 when pass is WAITING (use cancel instead)", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "WAITING" });

    const res = await request(server).post(`${BASE}/100/deny`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when pass is not PENDING", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });

    const res = await request(server).post(`${BASE}/100/deny`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when pass not found", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/9999/deny`).send({});

    expect(res.status).toBe(404);
  });
});

// ─── POST /passes/:id/return ──────────────────────────────────────────────────

describe("POST /api/passes/:id/return", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(401);
  });

  it("student owner can return their own ACTIVE pass", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "COMPLETED",
      returnedAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("still returns 200 when releaseAndPromote fails after the pass was completed", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "COMPLETED",
      returnedAt: new Date(),
    });
    mockSlots.releaseAndPromote.mockRejectedValue(new Error("redis down"));

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("TEACHER can return a student's ACTIVE pass", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "COMPLETED",
      returnedAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("ADMIN can return a student's ACTIVE pass", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });
    mockPrisma.destination.findUnique.mockResolvedValue({ id: 1, maxOccupancy: 10 });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "COMPLETED",
      returnedAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(200);
  });

  it("returns 400 when pass is not ACTIVE", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "PENDING" });

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when pass not found", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/9999/return`).send({});

    expect(res.status).toBe(404);
  });

  it("another student returns 404 for a pass they don't own", async () => {
    authenticateAs(fakeOtherStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/return`).send({});

    expect(res.status).toBe(404);
  });
});

// ─── POST /passes/:id/cancel ──────────────────────────────────────────────────

describe("POST /api/passes/:id/cancel", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(401);
  });

  it("student owner can cancel a PENDING pass", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(fakePass);
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "CANCELLED",
      cancellerId: 10,
      cancelledAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("student owner can cancel a WAITING pass", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "WAITING" });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "CANCELLED",
      cancellerId: 10,
      cancelledAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("TEACHER can cancel a WAITING pass", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "WAITING" });
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...fakePass,
      status: "CANCELLED",
      cancellerId: 20,
      cancelledAt: new Date(),
    });

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("returns 403 when another student attempts to cancel", async () => {
    authenticateAs(fakeOtherStudent);
    // findFirst returns null because query filters by studentId = req.user.id
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    // 404 because pass not found for this student (ownership enforced in query)
    expect(res.status).toBe(404);
  });

  it("returns 400 when pass is ACTIVE (use return instead)", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "ACTIVE" });

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Pass must be PENDING or WAITING to cancel");
    expect(mockSlots.releaseAndPromote).not.toHaveBeenCalled();
  });

  it("returns 400 when pass is COMPLETED (not cancellable)", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue({ ...fakePass, status: "COMPLETED" });

    const res = await request(server).post(`${BASE}/100/cancel`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when pass not found", async () => {
    authenticateAs(fakeStudent);
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    const res = await request(server).post(`${BASE}/9999/cancel`).send({});

    expect(res.status).toBe(404);
  });
});
