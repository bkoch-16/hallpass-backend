import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validateQuery, validateBody, validateParams } from "../../src/middleware/validate";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("validateQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).default(20),
    cursor: z.string().optional(),
  });

  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() for valid query and applies parsed data", () => {
    const req = { query: { limit: "10", cursor: "5" } } as unknown as Request;

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as { query: { limit: number } }).query.limit).toBe(10);
  });

  it("defaults limit when not provided", () => {
    const req = { query: {} } as unknown as Request;

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as { query: { limit: number } }).query.limit).toBe(20);
  });

  it("returns 400 for invalid query", () => {
    const req = { query: { limit: "0" } } as unknown as Request;

    validateQuery(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid query" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("includes Zod errors in response", () => {
    const req = { query: { limit: "abc" } } as unknown as Request;

    validateQuery(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonCall).toHaveProperty("errors");
  });
});

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().optional(),
  });

  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() for valid body and replaces req.body with parsed data", () => {
    const req = { body: { name: "Test", count: 5, extra: "stripped" } } as unknown as Request;

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body.name).toBe("Test");
    expect(req.body).not.toHaveProperty("extra");
  });

  it("returns 400 for missing required field", () => {
    const req = { body: {} } as unknown as Request;

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid body" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for empty string name", () => {
    const req = { body: { name: "" } } as unknown as Request;

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("includes Zod error details", () => {
    const req = { body: {} } as unknown as Request;

    validateBody(schema)(req, res, next);

    const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonCall).toHaveProperty("errors");
  });
});

describe("validateParams", () => {
  const schema = z.object({
    id: z.string().regex(/^\d+$/, "must be numeric"),
  });

  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it("calls next() for valid params", () => {
    const req = { params: { id: "42" } } as unknown as Request;

    validateParams(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.params.id).toBe("42");
  });

  it("returns 400 for invalid params", () => {
    const req = { params: { id: "abc" } } as unknown as Request;

    validateParams(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid params" }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
