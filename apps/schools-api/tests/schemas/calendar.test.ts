import { describe, it, expect } from "vitest";
import {
  calendarIdSchema,
  calendarQuerySchema,
  calendarEntrySchema,
  calendarBulkSchema,
  updateCalendarSchema,
} from "../../src/schemas/calendar";

describe("calendarIdSchema", () => {
  it("accepts valid schoolId and id", () => {
    expect(calendarIdSchema.safeParse({ schoolId: "1", id: "clxyz" }).success).toBe(true);
  });

  it("rejects non-numeric schoolId", () => {
    expect(calendarIdSchema.safeParse({ schoolId: "abc", id: "x" }).success).toBe(false);
  });

  it("rejects empty id", () => {
    expect(calendarIdSchema.safeParse({ schoolId: "1", id: "" }).success).toBe(false);
  });
});

describe("calendarQuerySchema", () => {
  it("accepts both optional, no values", () => {
    const r = calendarQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.from).toBeUndefined();
    expect(r.data?.to).toBeUndefined();
  });

  it("accepts valid from and to dates", () => {
    const r = calendarQuerySchema.safeParse({ from: "2025-01-01", to: "2025-06-30" });
    expect(r.success).toBe(true);
    expect(r.data?.from).toBe("2025-01-01");
    expect(r.data?.to).toBe("2025-06-30");
  });

  it("rejects invalid date format", () => {
    expect(calendarQuerySchema.safeParse({ from: "01/01/2025" }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ from: "2025-1-1" }).success).toBe(false);
  });
});

describe("calendarEntrySchema", () => {
  it("accepts date only", () => {
    const r = calendarEntrySchema.safeParse({ date: "2025-09-01" });
    expect(r.success).toBe(true);
    expect(r.data?.date).toBe("2025-09-01");
  });

  it("accepts date with optional scheduleTypeId", () => {
    const r = calendarEntrySchema.safeParse({ date: "2025-09-01", scheduleTypeId: "clxyz" });
    expect(r.success).toBe(true);
  });

  it("accepts date with note", () => {
    const r = calendarEntrySchema.safeParse({ date: "2025-09-01", note: "Holiday" });
    expect(r.success).toBe(true);
    expect(r.data?.note).toBe("Holiday");
  });

  it("accepts scheduleTypeId: null", () => {
    const r = calendarEntrySchema.safeParse({ date: "2025-09-01", scheduleTypeId: null });
    expect(r.success).toBe(true);
    expect(r.data?.scheduleTypeId).toBeNull();
  });

  it("rejects invalid date format", () => {
    expect(calendarEntrySchema.safeParse({ date: "09/01/2025" }).success).toBe(false);
  });

  it("rejects missing date", () => {
    expect(calendarEntrySchema.safeParse({}).success).toBe(false);
  });
});

describe("calendarBulkSchema", () => {
  it("accepts a single entry object", () => {
    const r = calendarBulkSchema.safeParse({ date: "2025-09-01" });
    expect(r.success).toBe(true);
  });

  it("accepts an array of entries", () => {
    const r = calendarBulkSchema.safeParse([
      { date: "2025-09-01" },
      { date: "2025-09-02", scheduleTypeId: "clxyz" },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects empty array", () => {
    expect(calendarBulkSchema.safeParse([]).success).toBe(false);
  });

  it("rejects array with invalid entry", () => {
    expect(calendarBulkSchema.safeParse([{ date: "not-a-date" }]).success).toBe(false);
  });
});

describe("updateCalendarSchema", () => {
  it("accepts scheduleTypeId update", () => {
    expect(updateCalendarSchema.safeParse({ scheduleTypeId: "clxyz" }).success).toBe(true);
  });

  it("accepts note update", () => {
    expect(updateCalendarSchema.safeParse({ note: "Snow day" }).success).toBe(true);
  });

  it("accepts scheduleTypeId: null", () => {
    const r = updateCalendarSchema.safeParse({ scheduleTypeId: null });
    expect(r.success).toBe(true);
    expect(r.data?.scheduleTypeId).toBeNull();
  });

  it("rejects empty object (at-least-one-field)", () => {
    expect(updateCalendarSchema.safeParse({}).success).toBe(false);
  });
});
