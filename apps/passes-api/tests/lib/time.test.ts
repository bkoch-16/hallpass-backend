import { describe, it, expect, afterEach, vi } from "vitest";
import { getIntervalStart } from "../../src/lib/time.js";

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
