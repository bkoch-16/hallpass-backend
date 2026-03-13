import { describe, it, expect } from "vitest";
import {
  periodIdSchema,
  createPeriodSchema,
  updatePeriodSchema,
} from "../../src/schemas/period";

describe("periodIdSchema", () => {
  it("accepts valid schoolId, scheduleTypeId, and id", () => {
    const r = periodIdSchema.safeParse({ schoolId: "1", scheduleTypeId: "2", id: "3" });
    expect(r.success).toBe(true);
  });

  it("rejects non-numeric schoolId", () => {
    expect(periodIdSchema.safeParse({ schoolId: "abc", scheduleTypeId: "2", id: "3" }).success).toBe(false);
  });

  it("rejects non-numeric scheduleTypeId", () => {
    expect(periodIdSchema.safeParse({ schoolId: "1", scheduleTypeId: "abc", id: "3" }).success).toBe(false);
  });

  it("rejects empty scheduleTypeId", () => {
    expect(periodIdSchema.safeParse({ schoolId: "1", scheduleTypeId: "", id: "3" }).success).toBe(false);
  });

  it("rejects non-numeric id", () => {
    expect(periodIdSchema.safeParse({ schoolId: "1", scheduleTypeId: "2", id: "abc" }).success).toBe(false);
  });

  it("rejects empty id", () => {
    expect(periodIdSchema.safeParse({ schoolId: "1", scheduleTypeId: "2", id: "" }).success).toBe(false);
  });
});

describe("createPeriodSchema", () => {
  it("accepts valid period data", () => {
    const r = createPeriodSchema.safeParse({
      name: "Period 1",
      startTime: "08:00",
      endTime: "09:00",
      order: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid startTime format", () => {
    expect(
      createPeriodSchema.safeParse({ name: "P1", startTime: "8:00", endTime: "09:00", order: 0 }).success,
    ).toBe(false);
  });

  it("rejects invalid endTime format", () => {
    expect(
      createPeriodSchema.safeParse({ name: "P1", startTime: "08:00", endTime: "9am", order: 0 }).success,
    ).toBe(false);
  });

  it("rejects missing name", () => {
    expect(
      createPeriodSchema.safeParse({ startTime: "08:00", endTime: "09:00", order: 0 }).success,
    ).toBe(false);
  });

  it("rejects negative order", () => {
    expect(
      createPeriodSchema.safeParse({ name: "P1", startTime: "08:00", endTime: "09:00", order: -1 }).success,
    ).toBe(false);
  });

  it("accepts order=0", () => {
    const r = createPeriodSchema.safeParse({ name: "P1", startTime: "08:00", endTime: "09:00", order: 0 });
    expect(r.success).toBe(true);
  });

  it("accepts HH:MM times like 00:00 and 23:59", () => {
    expect(
      createPeriodSchema.safeParse({ name: "P1", startTime: "00:00", endTime: "23:59", order: 1 }).success,
    ).toBe(true);
  });
});

describe("updatePeriodSchema", () => {
  it("accepts name only", () => {
    expect(updatePeriodSchema.safeParse({ name: "Lunch" }).success).toBe(true);
  });

  it("accepts startTime only", () => {
    expect(updatePeriodSchema.safeParse({ startTime: "09:30" }).success).toBe(true);
  });

  it("accepts order only", () => {
    expect(updatePeriodSchema.safeParse({ order: 2 }).success).toBe(true);
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updatePeriodSchema.safeParse({}).success).toBe(false);
  });

  it("rejects invalid time format in update", () => {
    expect(updatePeriodSchema.safeParse({ startTime: "9:00" }).success).toBe(false);
  });
});
