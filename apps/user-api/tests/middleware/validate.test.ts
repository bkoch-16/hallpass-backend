import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../../src/middleware/validate";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const schema = z.object({ name: z.string().min(1) });

describe("validateBody", () => {
  it("calls next() and assigns parsed data to req.body", () => {
    const req = { body: { name: "Alice" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: "Alice" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("strips unknown fields from req.body", () => {
    const req = { body: { name: "Alice", extra: "stripped" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(req.body).toEqual({ name: "Alice" });
    expect(req.body).not.toHaveProperty("extra");
  });

  it("returns 400 with errors for invalid input", () => {
    const req = { body: { name: "" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid body" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when required field is missing", () => {
    const req = { body: {} } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("validateQuery", () => {
  it("calls next() for valid query params", () => {
    const req = { query: { name: "Alice" } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 with errors for invalid query params", () => {
    const req = { query: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid query" }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("validateParams", () => {
  it("calls next() for valid params", () => {
    const req = { params: { name: "Alice" } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    validateParams(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 with errors for invalid params", () => {
    const req = { params: { name: "" } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    validateParams(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid params" }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
