/**
 * Integration tests for passes routes.
 * Uses real Prisma against live test DB. Auth and external deps are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

const { mockGetSession, mockClaimSlot, mockReleaseSlot, mockPromoteFromQueue, mockReconcileSlots, mockReleaseAndPromote } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockClaimSlot: vi.fn().mockResolvedValue(true),
    mockReleaseSlot: vi.fn().mockResolvedValue(undefined),
    mockPromoteFromQueue: vi.fn().mockResolvedValue(undefined),
    mockReconcileSlots: vi.fn().mockResolvedValue(undefined),
    mockReleaseAndPromote: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

vi.mock("../../src/lib/slots.js", () => ({
  claimSlot: mockClaimSlot,
  releaseSlot: mockReleaseSlot,
  promoteFromQueue: mockPromoteFromQueue,
  reconcileSlots: mockReconcileSlots,
  releaseAndPromote: mockReleaseAndPromote,
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../../src/lib/queue.js", () => ({
  schedulePassExpiry: vi.fn().mockResolvedValue(undefined),
}));

import app from "../../src/app";
import { prisma } from "@hallpass/db";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedDistrict(name = "Test District") {
  return prisma.district.create({ data: { name } });
}

async function seedSchool(
  overrides: Partial<{
    name: string;
    timezone: string;
    districtId: number | null;
  }> = {},
) {
  return prisma.school.create({
    data: {
      name: overrides.name ?? "Test School",
      timezone: overrides.timezone ?? "UTC",
      ...(overrides.districtId !== undefined ? { districtId: overrides.districtId } : {}),
    },
  });
}

async function seedScheduleType(schoolId: number) {
  return prisma.scheduleType.create({
    data: {
      schoolId,
      name: "Default",
      startBuffer: 0,
      endBuffer: 0,
    },
  });
}

async function seedUser(
  overrides: Partial<{
    role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPER_ADMIN";
    schoolId: number | null;
  }> = {},
) {
  return prisma.user.create({
    data: {
      email: `user-${crypto.randomUUID()}@test.com`,
      name: "Test User",
      role: overrides.role ?? "STUDENT",
      schoolId: overrides.schoolId ?? null,
    },
  });
}

async function seedDestination(
  schoolId: number,
  overrides: Partial<{
    name: string;
    maxOccupancy: number | null;
  }> = {},
) {
  return prisma.destination.create({
    data: {
      schoolId,
      name: overrides.name ?? "Test Destination",
      maxOccupancy: overrides.maxOccupancy ?? 10,
    },
  });
}

async function seedPeriod(
  schoolId: number,
  scheduleTypeId: number,
  overrides: Partial<{
    name: string;
    startTime: string;
    endTime: string;
    order: number;
  }> = {},
) {
  return prisma.period.create({
    data: {
      schoolId,
      scheduleTypeId,
      name: overrides.name ?? "Test Period",
      startTime: overrides.startTime ?? "00:00",
      endTime: overrides.endTime ?? "23:59",
      order: overrides.order ?? 1,
    },
  });
}

async function seedSchoolCalendar(schoolId: number, scheduleTypeId: number, date?: string) {
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  return prisma.schoolCalendar.create({
    data: {
      schoolId,
      date: new Date(dateStr + "T00:00:00Z"),
      scheduleTypeId,
    },
  });
}

async function seedPassPolicy(
  schoolId: number,
  overrides: Partial<{
    maxActivePasses: number | null;
    interval: "DAY" | "WEEK" | "MONTH" | null;
    maxPerInterval: number | null;
  }> = {},
) {
  return prisma.passPolicy.create({
    data: {
      schoolId,
      maxActivePasses: overrides.maxActivePasses ?? null,
      interval: overrides.interval ?? null,
      maxPerInterval: overrides.maxPerInterval ?? null,
    },
  });
}

async function seedPass(
  schoolId: number,
  studentId: number,
  destinationId: number,
  overrides: Partial<{
    periodId: number | null;
    status: "PENDING" | "WAITING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "DENIED" | "EXPIRED";
    note: string | null;
    approverId: number | null;
    denierId: number | null;
    cancellerId: number | null;
  }> = {},
) {
  return prisma.pass.create({
    data: {
      schoolId,
      studentId,
      destinationId,
      periodId: overrides.periodId ?? null,
      status: overrides.status ?? "PENDING",
      note: overrides.note ?? null,
      approverId: overrides.approverId ?? null,
      denierId: overrides.denierId ?? null,
      cancellerId: overrides.cancellerId ?? null,
    },
  });
}

function authenticateAs(user: { id: number }) {
  mockGetSession.mockResolvedValue({ user: { id: user.id }, session: {} });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function cleanDb() {
  await prisma.pass.deleteMany();
  await prisma.passPolicy.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.period.deleteMany();
  await prisma.schoolCalendar.deleteMany();
  await prisma.scheduleType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockClaimSlot.mockResolvedValue(true);
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Shared helper: seed a fully wired school for POST /passes to succeed
// Seeds ScheduleType, Period (00:00–23:59), SchoolCalendar for today
// ---------------------------------------------------------------------------

async function seedActiveSchool() {
  const school = await seedSchool({ timezone: "UTC" });
  const scheduleType = await seedScheduleType(school.id);
  const destination = await seedDestination(school.id);
  const period = await seedPeriod(school.id, scheduleType.id);
  await seedSchoolCalendar(school.id, scheduleType.id);
  return { school, scheduleType, destination, period };
}

// ---------------------------------------------------------------------------
// POST /api/passes
// ---------------------------------------------------------------------------

describe("POST /api/passes (integration)", () => {
  it("201 student creates pass when school has active period and destination", async () => {
    const { school, destination } = await seedActiveSchool();
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app)
      .post("/api/passes")
      .send({ destinationId: destination.id });

    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe(student.id);
    expect(res.body.destinationId).toBe(destination.id);
    expect(res.body.status).toBe("PENDING");

    const inDb = await prisma.pass.findUnique({ where: { id: res.body.id } });
    expect(inDb).not.toBeNull();
  });

  it("401 unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/passes")
      .send({ destinationId: 1 });

    expect(res.status).toBe(401);
  });

  it("422 student has no schoolId", async () => {
    const student = await seedUser({ role: "STUDENT", schoolId: null });
    authenticateAs(student);

    const res = await request(app)
      .post("/api/passes")
      .send({ destinationId: 1 });

    expect(res.status).toBe(422);
  });

  it("422 no active period when no calendar entry exists for today", async () => {
    const school = await seedSchool({ timezone: "UTC" });
    const scheduleType = await seedScheduleType(school.id);
    await seedPeriod(school.id, scheduleType.id);
    const destination = await seedDestination(school.id);
    // No SchoolCalendar entry seeded — route returns 422 "No active period"
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app)
      .post("/api/passes")
      .send({ destinationId: destination.id });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("No active period");
  });

  it("400 missing destinationId in body", async () => {
    const { school } = await seedActiveSchool();
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app)
      .post("/api/passes")
      .send({});

    expect(res.status).toBe(400);
  });

  it("422 destination belongs to a different school", async () => {
    const { school } = await seedActiveSchool();
    const otherSchool = await seedSchool({ name: "Other School" });
    const otherDestination = await seedDestination(otherSchool.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const res = await request(app)
      .post("/api/passes")
      .send({ destinationId: otherDestination.id });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Destination not found");
  });

  it("409 second pass request rejected when student already has a PENDING pass (exercises partial unique index)", async () => {
    const { school, destination } = await seedActiveSchool();
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    authenticateAs(student);

    const first = await request(app).post("/api/passes").send({ destinationId: destination.id });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/passes").send({ destinationId: destination.id });
    expect(second.status).toBe(409);
    expect(second.body.message).toBe("Active pass already exists");
  });
});

// ---------------------------------------------------------------------------
// GET /api/passes
// ---------------------------------------------------------------------------

describe("GET /api/passes (integration)", () => {
  it("200 student sees only their own passes", async () => {
    const school = await seedSchool();
    const scheduleType = await seedScheduleType(school.id);
    const destination = await seedDestination(school.id);
    const period = await seedPeriod(school.id, scheduleType.id);
    const student1 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const student2 = await seedUser({ role: "STUDENT", schoolId: school.id });
    await seedPass(school.id, student1.id, destination.id, { periodId: period.id });
    await seedPass(school.id, student2.id, destination.id, { periodId: period.id });
    authenticateAs(student1);

    const res = await request(app).get("/api/passes");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentId).toBe(student1.id);
  });

  it("200 teacher sees all passes in school", async () => {
    const school = await seedSchool();
    const scheduleType = await seedScheduleType(school.id);
    const destination = await seedDestination(school.id);
    const period = await seedPeriod(school.id, scheduleType.id);
    const student1 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const student2 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    await seedPass(school.id, student1.id, destination.id, { periodId: period.id });
    await seedPass(school.id, student2.id, destination.id, { periodId: period.id });
    authenticateAs(teacher);

    const res = await request(app).get("/api/passes");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("401 unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get("/api/passes");

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/passes/:id
// ---------------------------------------------------------------------------

describe("GET /api/passes/:id (integration)", () => {
  it("200 student fetches own pass", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id);
    authenticateAs(student);

    const res = await request(app).get(`/api/passes/${pass.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pass.id);
  });

  it("404 student cannot fetch another student's pass", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student1 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const student2 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student2.id, destination.id);
    authenticateAs(student1);

    const res = await request(app).get(`/api/passes/${pass.id}`);

    expect(res.status).toBe(404);
  });

  it("200 teacher fetches any pass in school", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id);
    authenticateAs(teacher);

    const res = await request(app).get(`/api/passes/${pass.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pass.id);
  });

  it("404 pass not found", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).get("/api/passes/99999");

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/passes/:id/approve
// ---------------------------------------------------------------------------

describe("POST /api/passes/:id/approve (integration)", () => {
  it("200 teacher approves PENDING pass → ACTIVE when slot is available", async () => {
    mockClaimSlot.mockResolvedValueOnce(true);
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.approverId).toBe(teacher.id);
  });

  it("200 teacher approves PENDING pass → WAITING when no slot available", async () => {
    mockClaimSlot.mockResolvedValueOnce(false);
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("WAITING");
  });

  it("400 cannot approve a pass that is not PENDING", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "ACTIVE" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/approve`).send({});

    expect(res.status).toBe(400);
  });

  it("403 student cannot approve a pass", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/approve`).send({});

    expect(res.status).toBe(403);
  });

  it("404 pass not found", async () => {
    const school = await seedSchool();
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    authenticateAs(teacher);

    const res = await request(app).post("/api/passes/99999/approve").send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/passes/:id/deny
// ---------------------------------------------------------------------------

describe("POST /api/passes/:id/deny (integration)", () => {
  it("200 teacher denies PENDING pass → DENIED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/deny`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DENIED");
    expect(res.body.denierId).toBe(teacher.id);
  });

  it("400 cannot deny a WAITING pass (must cancel instead)", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "WAITING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/deny`).send({});

    expect(res.status).toBe(400);
  });

  it("400 cannot deny a pass that is not PENDING", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "ACTIVE" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/deny`).send({});

    expect(res.status).toBe(400);
  });

  it("403 student cannot deny a pass", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/deny`).send({});

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/passes/:id/return
// ---------------------------------------------------------------------------

describe("POST /api/passes/:id/return (integration)", () => {
  it("200 student returns own ACTIVE pass → COMPLETED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "ACTIVE" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/return`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.returnedAt).not.toBeNull();
  });

  it("200 teacher returns ACTIVE pass → COMPLETED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "ACTIVE" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/return`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("400 cannot return a pass that is not ACTIVE", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/return`);

    expect(res.status).toBe(400);
  });

  it("404 student cannot return another student's pass", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student1 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const student2 = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student2.id, destination.id, { status: "ACTIVE" });
    authenticateAs(student1);

    const res = await request(app).post(`/api/passes/${pass.id}/return`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/passes/:id/cancel
// ---------------------------------------------------------------------------

describe("POST /api/passes/:id/cancel (integration)", () => {
  it("200 student cancels own PENDING pass → CANCELLED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancellerId).toBe(student.id);
  });

  it("200 teacher cancels any PENDING pass in school → CANCELLED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "PENDING" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancellerId).toBe(teacher.id);
  });

  it("400 cannot cancel a pass that is ACTIVE (use return instead)", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "ACTIVE" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/cancel`).send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Pass must be PENDING or WAITING to cancel");
  });

  it("400 cannot cancel a pass that is already COMPLETED", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const teacher = await seedUser({ role: "TEACHER", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "COMPLETED" });
    authenticateAs(teacher);

    const res = await request(app).post(`/api/passes/${pass.id}/cancel`).send({});

    expect(res.status).toBe(400);
  });

  it("200 student cancels WAITING pass → CANCELLED without releasing a slot", async () => {
    const school = await seedSchool();
    const destination = await seedDestination(school.id);
    const student = await seedUser({ role: "STUDENT", schoolId: school.id });
    const pass = await seedPass(school.id, student.id, destination.id, { status: "WAITING" });
    authenticateAs(student);

    const res = await request(app).post(`/api/passes/${pass.id}/cancel`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(mockReleaseAndPromote).not.toHaveBeenCalled();
  });
});
