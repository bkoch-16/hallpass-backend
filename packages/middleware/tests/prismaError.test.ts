import { describe, it, expect } from "vitest";
import { isPrismaError } from "../src/prismaError";

describe("isPrismaError", () => {
  it("returns true when the code matches and no target is given", () => {
    expect(isPrismaError({ code: "P2003" }, "P2003")).toBe(true);
  });

  it("returns false when the code doesn't match", () => {
    expect(isPrismaError({ code: "P2002" }, "P2003")).toBe(false);
  });

  it("returns false for null or non-object err", () => {
    expect(isPrismaError(null, "P2003")).toBe(false);
    expect(isPrismaError("P2003", "P2003")).toBe(false);
    expect(isPrismaError(undefined, "P2003")).toBe(false);
  });

  it("matches a target inside an array meta.target", () => {
    expect(isPrismaError({ code: "P2002", meta: { target: ["pinCode"] } }, "P2002", "pinCode")).toBe(true);
  });

  it("returns false when the array meta.target doesn't include the target", () => {
    expect(isPrismaError({ code: "P2002", meta: { target: ["email"] } }, "P2002", "pinCode")).toBe(false);
  });

  it("matches a target given as a plain string meta.target", () => {
    expect(isPrismaError({ code: "P2002", meta: { target: "pinCode" } }, "P2002", "pinCode")).toBe(true);
  });

  it("returns false when meta.target is missing but a target was requested", () => {
    expect(isPrismaError({ code: "P2002" }, "P2002", "pinCode")).toBe(false);
  });
});
