import { describe, it, expect, afterEach, vi } from "vitest";
import { calendarDate, getIntervalStart } from "../../src/lib/time.js";

describe("calendarDate", () => {
  it("returns the UTC-midnight Date for a 'YYYY-MM-DD' string", () => {
    expect(calendarDate("2026-07-07").toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("getIntervalStart WEEK", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("on a Sunday, the week started the previous Monday (Monday-start weeks per SCHEMA_PLAN)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z")); // Sunday
    expect(getIntervalStart("WEEK", "UTC").toISOString()).toBe("2026-06-29T00:00:00.000Z"); // previous Monday
  });

  it("on a Monday, the week started that same day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00Z")); // Monday
    expect(getIntervalStart("WEEK", "UTC").toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("mid-week resolves to the current week's Monday in the school timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z")); // Wednesday
    expect(getIntervalStart("WEEK", "America/New_York").toISOString()).toBe("2026-06-29T04:00:00.000Z"); // Monday 00:00 EDT
  });
});
