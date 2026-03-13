import { describe, it, expect } from "vitest";
import {
  scheduleTypeIdSchema,
  createScheduleTypeSchema,
  updateScheduleTypeSchema,
} from "../../src/schemas/scheduleType";

describe("scheduleTypeIdSchema", () => {
  it("accepts valid schoolId and id", () => {
    const r = scheduleTypeIdSchema.safeParse({ schoolId: "1", id: "1" });
    expect(r.success).toBe(true);
  });

  it("rejects non-numeric schoolId", () => {
    expect(scheduleTypeIdSchema.safeParse({ schoolId: "abc", id: "1" }).success).toBe(false);
  });

  it("rejects non-numeric id", () => {
    expect(scheduleTypeIdSchema.safeParse({ schoolId: "1", id: "abc" }).success).toBe(false);
  });

  it("rejects empty id", () => {
    expect(scheduleTypeIdSchema.safeParse({ schoolId: "1", id: "" }).success).toBe(false);
  });
});

describe("createScheduleTypeSchema", () => {
  it("accepts name only", () => {
    const r = createScheduleTypeSchema.safeParse({ name: "A Block" });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe("A Block");
  });

  it("accepts name with startBuffer and endBuffer", () => {
    const r = createScheduleTypeSchema.safeParse({ name: "A Block", startBuffer: 5, endBuffer: 10 });
    expect(r.success).toBe(true);
    expect(r.data?.startBuffer).toBe(5);
    expect(r.data?.endBuffer).toBe(10);
  });

  it("startBuffer and endBuffer are optional", () => {
    const r = createScheduleTypeSchema.safeParse({ name: "A Block" });
    expect(r.success).toBe(true);
    expect(r.data?.startBuffer).toBeUndefined();
    expect(r.data?.endBuffer).toBeUndefined();
  });

  it("rejects missing name", () => {
    expect(createScheduleTypeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createScheduleTypeSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects negative startBuffer", () => {
    expect(createScheduleTypeSchema.safeParse({ name: "A", startBuffer: -1 }).success).toBe(false);
  });

  it("accepts startBuffer=0", () => {
    const r = createScheduleTypeSchema.safeParse({ name: "A", startBuffer: 0 });
    expect(r.success).toBe(true);
  });
});

describe("updateScheduleTypeSchema", () => {
  it("accepts name update", () => {
    expect(updateScheduleTypeSchema.safeParse({ name: "B Block" }).success).toBe(true);
  });

  it("accepts startBuffer update", () => {
    expect(updateScheduleTypeSchema.safeParse({ startBuffer: 3 }).success).toBe(true);
  });

  it("accepts endBuffer update", () => {
    expect(updateScheduleTypeSchema.safeParse({ endBuffer: 0 }).success).toBe(true);
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updateScheduleTypeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects negative endBuffer", () => {
    expect(updateScheduleTypeSchema.safeParse({ endBuffer: -1 }).success).toBe(false);
  });
});
