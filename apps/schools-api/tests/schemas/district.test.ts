import { describe, it, expect } from "vitest";
import {
  districtIdSchema,
  listDistrictsSchema,
  createDistrictSchema,
  updateDistrictSchema,
} from "../../src/schemas/district";

describe("districtIdSchema", () => {
  it("accepts a positive integer string", () => {
    expect(districtIdSchema.safeParse({ id: "1" }).success).toBe(true);
    expect(districtIdSchema.safeParse({ id: "999" }).success).toBe(true);
  });

  it("rejects non-numeric strings", () => {
    expect(districtIdSchema.safeParse({ id: "abc" }).success).toBe(false);
  });

  it("rejects negative numbers", () => {
    expect(districtIdSchema.safeParse({ id: "-1" }).success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(districtIdSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("listDistrictsSchema", () => {
  it("defaults limit to 50", () => {
    const r = listDistrictsSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(50);
  });

  it("coerces limit from string to number", () => {
    const r = listDistrictsSchema.safeParse({ limit: "10" });
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(10);
  });

  it("accepts valid cursor", () => {
    const r = listDistrictsSchema.safeParse({ cursor: "5" });
    expect(r.success).toBe(true);
    expect(r.data?.cursor).toBe("5");
  });

  it("cursor is optional", () => {
    const r = listDistrictsSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.cursor).toBeUndefined();
  });

  it("rejects cursor=0", () => {
    expect(listDistrictsSchema.safeParse({ cursor: "0" }).success).toBe(false);
  });

  it("rejects non-numeric cursor", () => {
    expect(listDistrictsSchema.safeParse({ cursor: "abc" }).success).toBe(false);
  });

  it("rejects limit > 100", () => {
    expect(listDistrictsSchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects limit < 1", () => {
    expect(listDistrictsSchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("createDistrictSchema", () => {
  it("accepts valid name", () => {
    const r = createDistrictSchema.safeParse({ name: "Test District" });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe("Test District");
  });

  it("rejects missing name", () => {
    expect(createDistrictSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createDistrictSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("strips unknown fields", () => {
    const r = createDistrictSchema.safeParse({ name: "Test", extra: "field" });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("extra");
  });
});

describe("updateDistrictSchema", () => {
  it("accepts partial update with name", () => {
    const r = updateDistrictSchema.safeParse({ name: "Updated" });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe("Updated");
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updateDistrictSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty string name", () => {
    expect(updateDistrictSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("strips unknown fields (leaving empty object → refine fails)", () => {
    const r = updateDistrictSchema.safeParse({ unknown: "x" });
    expect(r.success).toBe(false);
  });
});
