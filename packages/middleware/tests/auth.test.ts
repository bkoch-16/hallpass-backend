import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@hallpass/types";

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { resolveSessionUser, createRequireAuth } from "../src/auth";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
};

const mockGetSession = vi.fn();

const stubAuth = {
  api: { getSession: mockGetSession },
} as unknown as Parameters<typeof createRequireAuth>[0];

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const fakeUser = {
  id: 1,
  email: "admin@test.com",
  name: "Test Admin",
  role: "ADMIN" as UserRole,
  schoolId: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSessionUser", () => {
  it("returns the DB user for a valid session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(fakeUser);

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toEqual(fakeUser);
  });

  it("queries DB with deletedAt: null to exclude soft-deleted users", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(fakeUser);

    await resolveSessionUser(stubAuth, {});

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 1, deletedAt: null },
    });
  });

  it("returns null when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("network error"));

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when getSession returns null (no session)", async () => {
    mockGetSession.mockResolvedValue(null);

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when session user id is non-numeric", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "not-a-number" }, session: {} });

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when session user id is 0", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "0" }, session: {} });

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when session user id is negative", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "-1" }, session: {} });

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when the user is soft-deleted (deletedAt set)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const user = await resolveSessionUser(stubAuth, {});

    expect(user).toBeNull();
  });

  it("rejects when the DB query fails (error propagates, not swallowed)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockRejectedValue(new Error("DB connection lost"));

    await expect(resolveSessionUser(stubAuth, {})).rejects.toThrow(
      "DB connection lost",
    );
  });
});

describe("createRequireAuth", () => {
  const requireAuth = createRequireAuth(stubAuth);

  it("sets req.user and calls next() for a valid session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(fakeUser);
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(req.user).toEqual(fakeUser);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("queries DB with deletedAt: null to exclude soft-deleted users", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(fakeUser);
    const req = { headers: {} } as Request;

    await requireAuth(req, mockRes(), vi.fn());

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 1, deletedAt: null },
    });
  });

  it("returns 401 when getSession returns null (no session)", async () => {
    mockGetSession.mockResolvedValue(null);
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("network error"));
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when user is not found in DB (soft-deleted or missing)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "999" }, session: {} });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when session user id is non-numeric", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "not-a-number" }, session: {} });
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when session user id is 0", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "0" }, session: {} });
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("propagates DB errors when findFirst throws (Express catches and sends 500)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockRejectedValue(new Error("DB connection lost"));
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await expect(requireAuth(req, res, next)).rejects.toThrow("DB connection lost");
    expect(next).not.toHaveBeenCalled();
  });
});
