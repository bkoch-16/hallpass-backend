import { describe, it, expect, afterEach, vi } from "vitest";
import {
  addMinutesToTime,
  addMinutesToTimeClamped,
  calendarDate,
  getCurrentTimeInTimezone,
  getIntervalStart,
} from "../../src/lib/time.js";

describe("addMinutesToTimeClamped", () => {
  it("clamps a window start that would wrap past midnight to '00:00'", () => {
    expect(addMinutesToTimeClamped("00:05", -10)).toBe("00:00");
  });

  it("subtracts normally when no clamping is needed", () => {
    expect(addMinutesToTimeClamped("08:00", -30)).toBe("07:30");
  });
});

describe("addMinutesToTime", () => {
  it("still wraps at 24 h (buffered window ends rely on this)", () => {
    expect(addMinutesToTime("00:05", -10)).toBe("23:55");
  });
});

describe("calendarDate", () => {
  it("returns the UTC-midnight Date for a 'YYYY-MM-DD' string", () => {
    expect(calendarDate("2026-07-07").toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("getCurrentTimeInTimezone", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normalizes a '24:xx' formatter result to '00:xx' (ICU hour12:false midnight quirk)", () => {
    // format is an accessor property that returns a bound function — spy on the getter
    const formatSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "format", "get")
      .mockReturnValue(() => "24:07");

    try {
      expect(getCurrentTimeInTimezone("UTC")).toBe("00:07");
    } finally {
      formatSpy.mockRestore();
    }
  });

  it("returns '00:00' at local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00Z"));

    expect(getCurrentTimeInTimezone("UTC")).toBe("00:00");
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
