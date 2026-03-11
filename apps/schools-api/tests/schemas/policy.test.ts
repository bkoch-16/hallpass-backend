import { describe, it, expect } from "vitest";
import { upsertPolicySchema } from "../../src/schemas/policy";

describe("upsertPolicySchema", () => {
  it("accepts all fields null (clear policy)", () => {
    const r = upsertPolicySchema.safeParse({
      maxActivePasses: null,
      interval: null,
      maxPerInterval: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts maxActivePasses only (interval not set)", () => {
    const r = upsertPolicySchema.safeParse({ maxActivePasses: 5 });
    expect(r.success).toBe(true);
    expect(r.data?.maxActivePasses).toBe(5);
  });

  it("accepts interval + maxPerInterval together (DAY)", () => {
    const r = upsertPolicySchema.safeParse({ interval: "DAY", maxPerInterval: 3 });
    expect(r.success).toBe(true);
  });

  it("accepts interval + maxPerInterval together (WEEK)", () => {
    const r = upsertPolicySchema.safeParse({ interval: "WEEK", maxPerInterval: 10 });
    expect(r.success).toBe(true);
  });

  it("accepts interval + maxPerInterval together (MONTH)", () => {
    const r = upsertPolicySchema.safeParse({ interval: "MONTH", maxPerInterval: 20 });
    expect(r.success).toBe(true);
  });

  it("rejects interval without maxPerInterval", () => {
    const r = upsertPolicySchema.safeParse({ interval: "DAY" });
    expect(r.success).toBe(false);
  });

  it("rejects maxPerInterval without interval", () => {
    const r = upsertPolicySchema.safeParse({ maxPerInterval: 5 });
    expect(r.success).toBe(false);
  });

  it("rejects interval=null but maxPerInterval set", () => {
    const r = upsertPolicySchema.safeParse({ interval: null, maxPerInterval: 5 });
    expect(r.success).toBe(false);
  });

  it("rejects invalid interval value", () => {
    expect(upsertPolicySchema.safeParse({ interval: "YEAR", maxPerInterval: 5 }).success).toBe(false);
  });

  it("rejects non-positive maxActivePasses", () => {
    expect(upsertPolicySchema.safeParse({ maxActivePasses: 0 }).success).toBe(false);
  });

  it("rejects non-positive maxPerInterval", () => {
    expect(upsertPolicySchema.safeParse({ interval: "DAY", maxPerInterval: 0 }).success).toBe(false);
  });

  it("accepts both null/undefined interval and maxPerInterval (both absent = valid)", () => {
    const r = upsertPolicySchema.safeParse({ maxActivePasses: 3 });
    expect(r.success).toBe(true);
  });

  it("strips unknown fields", () => {
    const r = upsertPolicySchema.safeParse({ interval: "DAY", maxPerInterval: 2, extra: "x" });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("extra");
  });
});
