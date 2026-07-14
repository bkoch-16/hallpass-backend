import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireRole, requireSelfOrRole, requireMinRole, roleRank } from "../src/roleGuard";
import type { UserRole } from "@hallpass/types";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("roleRank", () => {
  it("ranks STUDENT as 0", () => expect(roleRank("STUDENT" as UserRole)).toBe(0));
  it("ranks TEACHER as 1", () => expect(roleRank("TEACHER" as UserRole)).toBe(1));
  it("ranks ADMIN as 2", () => expect(roleRank("ADMIN" as UserRole)).toBe(2));
  it("ranks SUPER_ADMIN as 3", () => expect(roleRank("SUPER_ADMIN" as UserRole)).toBe(3));
  it("ranks SERVICE as 4", () => expect(roleRank("SERVICE" as UserRole)).toBe(4));
  it("SUPER_ADMIN ranks higher than ADMIN", () => {
    expect(roleRank("SUPER_ADMIN" as UserRole)).toBeGreaterThan(roleRank("ADMIN" as UserRole));
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
    requireRole("ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when user has one of multiple allowed roles (TEACHER)", () => {
    const req = { user: { role: "TEACHER" } } as unknown as Request;
    requireRole("TEACHER" as UserRole, "ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when user has one of multiple allowed roles (ADMIN)", () => {
    const req = { user: { role: "ADMIN" } } as unknown as Request;
    requireRole("ADMIN" as UserRole, "SUPER_ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when user has one of multiple allowed roles (SUPER_ADMIN)", () => {
    const req = { user: { role: "SUPER_ADMIN" } } as unknown as Request;
    requireRole("ADMIN" as UserRole, "SUPER_ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when STUDENT attempts an ADMIN route", () => {
    const req = { user: { role: "STUDENT" } } as unknown as Request;
    requireRole("ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when TEACHER attempts a SUPER_ADMIN-only route", () => {
    const req = { user: { role: "TEACHER" } } as unknown as Request;
    requireRole("SUPER_ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when ADMIN attempts a SUPER_ADMIN-only route", () => {
    const req = { user: { role: "ADMIN" } } as unknown as Request;
    requireRole("SUPER_ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = {} as Request;
    requireRole("ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when SUPER_ADMIN has SUPER_ADMIN role", () => {
    const req = { user: { role: "SUPER_ADMIN" } } as unknown as Request;
    requireRole("SUPER_ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
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
      user: { id: 1, role: "STUDENT" },
      params: { id: "1" },
    } as unknown as Request;
    requireSelfOrRole("ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when user has the required role (accessing different resource)", () => {
    const req = {
      user: { id: 3, role: "ADMIN" },
      params: { id: "2" },
    } as unknown as Request;
    requireSelfOrRole("ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user is neither self nor has required role", () => {
    const req = {
      user: { id: 1, role: "TEACHER" },
      params: { id: "2" },
    } as unknown as Request;
    requireSelfOrRole("ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = { params: { id: "user-1" } } as unknown as Request;
    requireSelfOrRole("ADMIN" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireMinRole", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() when user rank equals the minimum", () => {
    const req = { user: { role: "TEACHER" } } as unknown as Request;
    requireMinRole("TEACHER" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when user rank is above the minimum", () => {
    const req = { user: { role: "ADMIN" } } as unknown as Request;
    requireMinRole("TEACHER" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when user rank is below the minimum", () => {
    const req = { user: { role: "STUDENT" } } as unknown as Request;
    requireMinRole("TEACHER" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = {} as Request;
    requireMinRole("TEACHER" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});

// Rank decision: SERVICE (4) ranks above SUPER_ADMIN (3), so requireMinRole(X)
// admits SERVICE for every X. requireRole is an exact-match allowlist and does
// NOT admit SERVICE unless it is listed explicitly.
describe("SERVICE rank decision", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("requireMinRole(TEACHER) admits SERVICE", () => {
    const req = { user: { role: "SERVICE" } } as unknown as Request;
    requireMinRole("TEACHER" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("requireMinRole(SUPER_ADMIN) admits SERVICE", () => {
    const req = { user: { role: "SERVICE" } } as unknown as Request;
    requireMinRole("SUPER_ADMIN" as UserRole)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("requireRole(TEACHER) does NOT admit SERVICE", () => {
    const req = { user: { role: "SERVICE" } } as unknown as Request;
    requireRole("TEACHER" as UserRole)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });
});
