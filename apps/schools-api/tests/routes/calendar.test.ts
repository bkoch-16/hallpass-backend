import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    scheduleType: { findFirst: vi.fn() },
    schoolCalendar: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
  schoolCalendar: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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

const fakeEntry = {
  id: 1,
  schoolId: 1,
  date: new Date("2025-09-01"),
  scheduleTypeId: null,
  note: null,
};

const BASE = "/api/schools/1/calendar";

beforeEach(() => {
  vi.clearAllMocks();
});

describe(`GET ${BASE}`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(401);
  });

  it("returns calendar entries for school member", async () => {
    authenticateAs(fakeTeacher);
    mockPrisma.schoolCalendar.findMany.mockResolvedValue([fakeEntry]);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("passes date filter to prisma when ?from= and ?to= provided", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findMany.mockResolvedValue([]);

    await request(app).get(`${BASE}?from=2025-01-01&to=2025-06-30`);

    expect(mockPrisma.schoolCalendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        }),
      }),
    );
  });

  it("returns 400 for invalid date format", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).get(`${BASE}?from=01/01/2025`);

    expect(res.status).toBe(400);
  });
});

describe(`POST ${BASE} (bulk upsert)`, () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).post(BASE).send([{ date: "2025-09-01" }]);

    expect(res.status).toBe(401);
  });

  it("returns 403 when TEACHER attempts bulk upsert", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app).post(BASE).send([{ date: "2025-09-01" }]);

    expect(res.status).toBe(403);
  });

  it("creates new entries and returns created count", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findUnique.mockResolvedValue(null); // not existing → create
    mockPrisma.schoolCalendar.create.mockResolvedValue(fakeEntry);

    const res = await request(app)
      .post(BASE)
      .send([{ date: "2025-09-01" }, { date: "2025-09-02" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.updated).toBe(0);
  });

  it("updates existing entries and returns updated count", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findUnique.mockResolvedValue(fakeEntry); // existing → update
    mockPrisma.schoolCalendar.update.mockResolvedValue(fakeEntry);

    const res = await request(app).post(BASE).send([{ date: "2025-09-01", note: "Updated" }]);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.updated).toBe(1);
  });

  it("accepts a single entry object (not array)", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findUnique.mockResolvedValue(null);
    mockPrisma.schoolCalendar.create.mockResolvedValue(fakeEntry);

    const res = await request(app).post(BASE).send({ date: "2025-09-01" });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  it("returns 422 when scheduleTypeId does not belong to the school", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.scheduleType.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .send([{ date: "2025-09-01", scheduleTypeId: 999 }]);

    expect(res.status).toBe(422);
    expect(mockPrisma.schoolCalendar.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid date in bulk array", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).post(BASE).send([{ date: "09/01/2025" }]);

    expect(res.status).toBe(400);
  });
});

describe(`PATCH ${BASE}/:id`, () => {
  it("returns 404 when calendar entry not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`${BASE}/99999`)
      .send({ note: "Updated" });

    expect(res.status).toBe(404);
    expect(mockPrisma.schoolCalendar.update).not.toHaveBeenCalled();
  });

  it("updates calendar entry and returns 200", async () => {
    authenticateAs(fakeAdmin);
    const updated = { ...fakeEntry, note: "Holiday" };
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeEntry);
    mockPrisma.schoolCalendar.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`${BASE}/1`)
      .send({ note: "Holiday" });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe("Holiday");
  });

  it("returns 400 for empty body", async () => {
    authenticateAs(fakeAdmin);

    const res = await request(app).patch(`${BASE}/1`).send({});

    expect(res.status).toBe(400);
  });
});

describe(`DELETE ${BASE}/:id`, () => {
  it("deletes calendar entry and returns 204", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(fakeEntry);
    mockPrisma.schoolCalendar.delete.mockResolvedValue(fakeEntry);

    const res = await request(app).delete(`${BASE}/1`);

    expect(res.status).toBe(204);
    expect(mockPrisma.schoolCalendar.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  it("returns 404 when calendar entry not found", async () => {
    authenticateAs(fakeAdmin);
    mockPrisma.schoolCalendar.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/999`);

    expect(res.status).toBe(404);
    expect(mockPrisma.schoolCalendar.delete).not.toHaveBeenCalled();
  });

  it("returns 403 when TEACHER attempts delete", async () => {
    authenticateAs(fakeTeacher);

    const res = await request(app).delete(`${BASE}/1`);

    expect(res.status).toBe(403);
  });
});
