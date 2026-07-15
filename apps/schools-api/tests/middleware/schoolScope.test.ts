import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireSchoolAccess, requireSchoolAccessIfSession } from "../../src/middleware/schoolScope.js";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireSchoolAccess", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() when user.schoolId matches :schoolId param", () => {
    const req = {
      user: { schoolId: 1, role: "ADMIN" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when user.schoolId does not match :schoolId param", () => {
    const req = {
      user: { schoolId: 2, role: "TEACHER" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN bypasses school scope check (different schoolId)", () => {
    const req = {
      user: { schoolId: 99, role: "SUPER_ADMIN" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN with null schoolId can access any school", () => {
    const req = {
      user: { schoolId: null, role: "SUPER_ADMIN" },
      params: { schoolId: "42" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when req.user is not set", () => {
    const req = {
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when user.schoolId is null and not SUPER_ADMIN", () => {
    const req = {
      user: { schoolId: null, role: "TEACHER" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("TEACHER with matching schoolId passes", () => {
    const req = {
      user: { schoolId: 5, role: "TEACHER" },
      params: { schoolId: "5" },
    } as unknown as Request;

    requireSchoolAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requireSchoolAccessIfSession", () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() without enforcing school scope when req.user is unset (API-key caller)", () => {
    const req = {
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccessIfSession(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("enforces requireSchoolAccess when req.user is set (session caller)", () => {
    const req = {
      user: { schoolId: 2, role: "TEACHER" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccessIfSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for a session caller with matching schoolId", () => {
    const req = {
      user: { schoolId: 1, role: "TEACHER" },
      params: { schoolId: "1" },
    } as unknown as Request;

    requireSchoolAccessIfSession(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
