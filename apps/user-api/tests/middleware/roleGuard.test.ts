import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("@hallpass/db", () => ({
  Role: {
    STUDENT: "STUDENT",
    TEACHER: "TEACHER",
    ADMIN: "ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
    SERVICE: "SERVICE",
  },
}));

import { requireRole, requireSelfOrRole, roleRank } from "../../src/middleware/roleGuard";
import { Role } from "@hallpass/db";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("roleRank", () => {
  it("ranks STUDENT as 0", () => expect(roleRank(Role.STUDENT)).toBe(0));
  it("ranks TEACHER as 1", () => expect(roleRank(Role.TEACHER)).toBe(1));
  it("ranks ADMIN as 2", () => expect(roleRank(Role.ADMIN)).toBe(2));
  it("ranks SUPER_ADMIN as 3", () => expect(roleRank(Role.SUPER_ADMIN)).toBe(3));
  it("ranks SERVICE as 4", () => expect(roleRank(Role.SERVICE)).toBe(4));
  it("SUPER_ADMIN ranks higher than ADMIN", () => {
    expect(roleRank(Role.SUPER_ADMIN)).toBeGreaterThan(roleRank(Role.ADMIN));
  });
});

describe("requireRole", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() when user has the required role", () => {
    const req = { user: { role: "ADMIN" } } as unknown as Request;
    requireRole(Role.ADMIN)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when user has one of multiple allowed roles", () => {
    const req = { user: { role: "TEACHER" } } as unknown as Request;
    requireRole(Role.TEACHER, Role.ADMIN)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user does not have the required role", () => {
    const req = { user: { role: "STUDENT" } } as unknown as Request;
    requireRole(Role.ADMIN)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = {} as Request;
    requireRole(Role.ADMIN)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireSelfOrRole", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() when user is accessing their own resource", () => {
    const req = {
      user: { id: "user-1", role: "STUDENT" },
      params: { id: "user-1" },
    } as unknown as Request;
    requireSelfOrRole(Role.ADMIN)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when user has the required role (accessing different resource)", () => {
    const req = {
      user: { id: "admin-1", role: "ADMIN" },
      params: { id: "user-2" },
    } as unknown as Request;
    requireSelfOrRole(Role.ADMIN)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user is neither self nor has required role", () => {
    const req = {
      user: { id: "teacher-1", role: "TEACHER" },
      params: { id: "user-2" },
    } as unknown as Request;
    requireSelfOrRole(Role.ADMIN)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = { params: { id: "user-1" } } as unknown as Request;
    requireSelfOrRole(Role.ADMIN)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});
