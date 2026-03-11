import { describe, it, expect } from "vitest";
import {
  schoolIdSchema,
  schoolParamSchema,
  listSchoolsSchema,
  createSchoolSchema,
  updateSchoolSchema,
} from "../../src/schemas/school";

describe("schoolIdSchema", () => {
  it("accepts a positive integer string", () => {
    expect(schoolIdSchema.safeParse({ id: "42" }).success).toBe(true);
  });

  it("rejects negative numbers", () => {
    expect(schoolIdSchema.safeParse({ id: "-1" }).success).toBe(false);
  });

  it("rejects non-numeric", () => {
    expect(schoolIdSchema.safeParse({ id: "abc" }).success).toBe(false);
  });
});

describe("schoolParamSchema", () => {
  it("accepts a positive integer string for schoolId", () => {
    expect(schoolParamSchema.safeParse({ schoolId: "1" }).success).toBe(true);
  });

  it("rejects non-numeric schoolId", () => {
    expect(schoolParamSchema.safeParse({ schoolId: "abc" }).success).toBe(false);
  });
});

describe("listSchoolsSchema", () => {
  it("defaults limit to 50", () => {
    const r = listSchoolsSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(50);
  });

  it("coerces limit from string", () => {
    const r = listSchoolsSchema.safeParse({ limit: "20" });
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(20);
  });

  it("cursor is optional", () => {
    const r = listSchoolsSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.cursor).toBeUndefined();
  });

  it("rejects limit > 100", () => {
    expect(listSchoolsSchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});

describe("createSchoolSchema", () => {
  it("accepts name only", () => {
    const r = createSchoolSchema.safeParse({ name: "Westside High" });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe("Westside High");
  });

  it("accepts name with optional timezone", () => {
    const r = createSchoolSchema.safeParse({ name: "Test", timezone: "America/New_York" });
    expect(r.success).toBe(true);
    expect(r.data?.timezone).toBe("America/New_York");
  });

  it("accepts name with optional districtId", () => {
    const r = createSchoolSchema.safeParse({ name: "Test", districtId: 5 });
    expect(r.success).toBe(true);
    expect(r.data?.districtId).toBe(5);
  });

  it("rejects missing name", () => {
    expect(createSchoolSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createSchoolSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects non-integer districtId", () => {
    expect(createSchoolSchema.safeParse({ name: "Test", districtId: 1.5 }).success).toBe(false);
  });

  it("rejects non-positive districtId", () => {
    expect(createSchoolSchema.safeParse({ name: "Test", districtId: 0 }).success).toBe(false);
  });
});

describe("updateSchoolSchema", () => {
  it("accepts partial update with name", () => {
    expect(updateSchoolSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("accepts partial update with timezone", () => {
    expect(updateSchoolSchema.safeParse({ timezone: "America/Chicago" }).success).toBe(true);
  });

  it("accepts districtId: null (unlink district)", () => {
    const r = updateSchoolSchema.safeParse({ districtId: null });
    expect(r.success).toBe(true);
    expect(r.data?.districtId).toBeNull();
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updateSchoolSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields only (stripped → empty → refine fails)", () => {
    expect(updateSchoolSchema.safeParse({ unknown: "x" }).success).toBe(false);
  });
});
