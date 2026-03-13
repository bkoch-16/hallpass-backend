import { describe, it, expect } from "vitest";
import {
  destinationIdSchema,
  createDestinationSchema,
  updateDestinationSchema,
} from "../../src/schemas/destination";

describe("destinationIdSchema", () => {
  it("accepts valid schoolId and id", () => {
    expect(destinationIdSchema.safeParse({ schoolId: "1", id: "1" }).success).toBe(true);
  });

  it("rejects non-numeric schoolId", () => {
    expect(destinationIdSchema.safeParse({ schoolId: "abc", id: "1" }).success).toBe(false);
  });

  it("rejects non-numeric id", () => {
    expect(destinationIdSchema.safeParse({ schoolId: "1", id: "abc" }).success).toBe(false);
  });

  it("rejects empty id", () => {
    expect(destinationIdSchema.safeParse({ schoolId: "1", id: "" }).success).toBe(false);
  });
});

describe("createDestinationSchema", () => {
  it("accepts name only", () => {
    const r = createDestinationSchema.safeParse({ name: "Library" });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe("Library");
  });

  it("accepts name with maxOccupancy", () => {
    const r = createDestinationSchema.safeParse({ name: "Library", maxOccupancy: 30 });
    expect(r.success).toBe(true);
    expect(r.data?.maxOccupancy).toBe(30);
  });

  it("accepts maxOccupancy: null", () => {
    const r = createDestinationSchema.safeParse({ name: "Library", maxOccupancy: null });
    expect(r.success).toBe(true);
    expect(r.data?.maxOccupancy).toBeNull();
  });

  it("maxOccupancy is optional", () => {
    const r = createDestinationSchema.safeParse({ name: "Library" });
    expect(r.success).toBe(true);
    expect(r.data?.maxOccupancy).toBeUndefined();
  });

  it("rejects missing name", () => {
    expect(createDestinationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createDestinationSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects non-integer maxOccupancy", () => {
    expect(createDestinationSchema.safeParse({ name: "Test", maxOccupancy: 1.5 }).success).toBe(false);
  });

  it("rejects non-positive maxOccupancy (zero)", () => {
    expect(createDestinationSchema.safeParse({ name: "Test", maxOccupancy: 0 }).success).toBe(false);
  });

  it("strips unknown fields", () => {
    const r = createDestinationSchema.safeParse({ name: "Library", extra: "x" });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("extra");
  });
});

describe("updateDestinationSchema", () => {
  it("accepts name update", () => {
    expect(updateDestinationSchema.safeParse({ name: "Gym" }).success).toBe(true);
  });

  it("accepts maxOccupancy update", () => {
    expect(updateDestinationSchema.safeParse({ maxOccupancy: 50 }).success).toBe(true);
  });

  it("accepts maxOccupancy: null (clear occupancy)", () => {
    const r = updateDestinationSchema.safeParse({ maxOccupancy: null });
    expect(r.success).toBe(true);
    expect(r.data?.maxOccupancy).toBeNull();
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updateDestinationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(updateDestinationSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
