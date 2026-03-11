import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireRole, roleRank } from "../../src/middleware/roleGuard";
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
