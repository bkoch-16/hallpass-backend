import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth } from "../../src/middleware/auth";
import { prisma } from "@hallpass/db";

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
};

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
  role: "ADMIN",
  schoolId: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAuth", () => {
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

  it("propagates DB errors when findFirst throws", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "1" }, session: {} });
    mockPrisma.user.findFirst.mockRejectedValue(new Error("DB connection lost"));
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await expect(requireAuth(req, res, next)).rejects.toThrow("DB connection lost");
    expect(next).not.toHaveBeenCalled();
  });
});
