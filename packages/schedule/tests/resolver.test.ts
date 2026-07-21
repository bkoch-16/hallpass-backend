import { describe, it, expect } from "vitest";
import { resolveSchedule, type PeriodInput } from "../src/resolver.js";

const scheduleType = { id: 1, startBuffer: 0, endBuffer: 0 };

const period = (overrides: Partial<PeriodInput> = {}): PeriodInput => ({
  id: 1,
  scheduleTypeId: 1,
  name: "Period 1",
  startTime: "08:00",
  endTime: "09:00",
  order: 0,
  ...overrides,
});

describe("resolveSchedule — no-calendar-entry day", () => {
  it("returns empty schedule when calendarEntry is null", () => {
    const result = resolveSchedule({
      calendarEntry: null,
      scheduleType,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T12:00:00Z"),
    });

    expect(result).toEqual({ date: "2026-07-21", periods: [], currentPeriod: null });
  });

  it("returns empty schedule when the calendar entry has no scheduleTypeId", () => {
    const result = resolveSchedule({
      calendarEntry: { scheduleTypeId: null },
      scheduleType: null,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T12:00:00Z"),
    });

    expect(result).toEqual({ date: "2026-07-21", periods: [], currentPeriod: null });
  });

  it("returns empty schedule when scheduleType is missing even though the entry names one", () => {
    const result = resolveSchedule({
      calendarEntry: { scheduleTypeId: 1 },
      scheduleType: null,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T12:00:00Z"),
    });

    expect(result).toEqual({ date: "2026-07-21", periods: [], currentPeriod: null });
  });
});

describe("resolveSchedule — period boundary edges (no buffers)", () => {
  const calendarEntry = { scheduleTypeId: 1 };

  it("matches exactly at the period start (inclusive)", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T08:00:00Z"),
    });

    expect(result.currentPeriod?.id).toBe(1);
  });

  it("matches exactly at the period end (inclusive)", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T09:00:00Z"),
    });

    expect(result.currentPeriod?.id).toBe(1);
  });

  it("does not match one minute before the period start (exclusive)", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T07:59:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
    expect(result.periods).toHaveLength(1);
  });

  it("does not match one minute after the period end (exclusive)", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T09:01:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
  });

  it("returns null between two periods (a gap) while still reporting both periods", () => {
    const morning = period({ id: 1, startTime: "08:00", endTime: "09:00", order: 0 });
    const afternoon = period({ id: 2, startTime: "10:00", endTime: "11:00", order: 1 });

    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [morning, afternoon],
      timezone: "UTC",
      now: new Date("2026-07-21T09:30:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
    expect(result.periods.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe("resolveSchedule — start/end buffers", () => {
  const calendarEntry = { scheduleTypeId: 1 };
  const buffered = { id: 1, startBuffer: 10, endBuffer: 5 };

  it("computes buffered windowStart/windowEnd", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T08:00:00Z"),
    });

    expect(result.periods[0].windowStart).toBe("07:50");
    expect(result.periods[0].windowEnd).toBe("09:05");
  });

  it("matches inside the start buffer", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T07:50:00Z"),
    });

    expect(result.currentPeriod?.id).toBe(1);
  });

  it("does not match just before the start buffer", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T07:49:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
  });

  it("matches inside the end buffer", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T09:05:00Z"),
    });

    expect(result.currentPeriod?.id).toBe(1);
  });

  it("does not match just after the end buffer", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period()],
      timezone: "UTC",
      now: new Date("2026-07-21T09:06:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
  });

  it("clamps the start buffer at 00:00 instead of wrapping past midnight", () => {
    const result = resolveSchedule({
      calendarEntry,
      scheduleType: buffered,
      periods: [period({ startTime: "00:05", endTime: "01:00" })],
      timezone: "UTC",
      now: new Date("2026-07-21T00:00:00Z"),
    });

    expect(result.periods[0].windowStart).toBe("00:00");
    expect(result.currentPeriod?.id).toBe(1);
  });

  it("picks the earliest-starting period when buffered windows overlap, regardless of input order", () => {
    const first = period({ id: 1, startTime: "08:00", endTime: "09:05", order: 0 });
    const second = period({ id: 2, startTime: "09:00", endTime: "10:00", order: 1 });

    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [second, first], // reversed on purpose
      timezone: "UTC",
      now: new Date("2026-07-21T09:02:00Z"), // inside both windows
    });

    expect(result.currentPeriod?.id).toBe(1);
  });
});

describe("resolveSchedule — timezone edges", () => {
  it("resolves the school-local date and time, not the UTC ones, late in the UTC day", () => {
    // 2026-07-21T05:30:00Z is 2026-07-20T22:30:00-07:00 in America/Los_Angeles (PDT).
    const calendarEntry = { scheduleTypeId: 1 };
    const eveningPeriod = period({ id: 1, startTime: "22:00", endTime: "23:00" });

    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [eveningPeriod],
      timezone: "America/Los_Angeles",
      now: new Date("2026-07-21T05:30:00Z"),
    });

    expect(result.date).toBe("2026-07-20");
    expect(result.currentPeriod?.id).toBe(1);
  });

  it("does not match the same instant against UTC period times", () => {
    const calendarEntry = { scheduleTypeId: 1 };
    // A period at "05:30" would match if the resolver mistakenly used UTC time.
    const utcLookingPeriod = period({ id: 1, startTime: "05:00", endTime: "06:00" });

    const result = resolveSchedule({
      calendarEntry,
      scheduleType,
      periods: [utcLookingPeriod],
      timezone: "America/Los_Angeles",
      now: new Date("2026-07-21T05:30:00Z"),
    });

    expect(result.currentPeriod).toBeNull();
  });
});
