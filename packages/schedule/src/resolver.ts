import {
  getTodayInTimezone,
  getCurrentTimeInTimezone,
  addMinutesToTimeClamped,
} from "./time.js";

export interface CalendarEntryInput {
  scheduleTypeId: number | null;
}

export interface ScheduleTypeInput {
  id: number;
  startBuffer: number;
  endBuffer: number;
}

export interface PeriodInput {
  id: number;
  scheduleTypeId: number;
  name: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  order: number;
}

export interface PeriodWindow extends PeriodInput {
  windowStart: string; // startTime, buffered by scheduleType.startBuffer, clamped at "00:00"
  windowEnd: string; // endTime, buffered by scheduleType.endBuffer, clamped at "23:59"
}

export interface ResolvedSchedule {
  date: string; // school-local "YYYY-MM-DD"
  periods: PeriodWindow[];
  currentPeriod: PeriodWindow | null;
}

export interface ResolveScheduleInput {
  calendarEntry: CalendarEntryInput | null;
  scheduleType: ScheduleTypeInput | null;
  periods: PeriodInput[];
  timezone: string;
  now?: Date;
}

// Works because "HH:MM" strings are zero-padded and equal-length.
function timeLeq(a: string, b: string): boolean {
  return a <= b;
}

/**
 * Resolve the active period (if any) for a school, given today's calendar
 * entry, the schedule type it points to, and that schedule type's periods.
 * Pure function — no DB access; callers own fetching the plain inputs.
 *
 * Mirrors the active-period resolution formerly inlined in
 * apps/passes-api/src/routes/passes.ts.
 */
export function resolveSchedule(input: ResolveScheduleInput): ResolvedSchedule {
  const now = input.now ?? new Date();
  const date = getTodayInTimezone(input.timezone, now);

  if (
    !input.calendarEntry ||
    input.calendarEntry.scheduleTypeId === null ||
    !input.scheduleType
  ) {
    return { date, periods: [], currentPeriod: null };
  }

  const currentTime = getCurrentTimeInTimezone(input.timezone, now);
  const { startBuffer, endBuffer } = input.scheduleType;

  const periods: PeriodWindow[] = input.periods.map((p) => ({
    ...p,
    // Clamped, not wrapped: a start buffer crossing midnight must yield
    // "00:00" (not wrap to "23:xx") and an end buffer crossing midnight must
    // yield "23:59" (not wrap to "00:xx") — a wrapped bound can never match.
    windowStart: addMinutesToTimeClamped(p.startTime, -startBuffer),
    windowEnd: addMinutesToTimeClamped(p.endTime, endBuffer),
  }));

  // Buffer windows of adjacent periods overlap — order so the earliest
  // start-time match wins deterministically, independent of input order.
  const byStartTime = [...periods].sort((a, b) =>
    a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0,
  );

  const currentPeriod =
    byStartTime.find(
      (p) => timeLeq(p.windowStart, currentTime) && timeLeq(currentTime, p.windowEnd),
    ) ?? null;

  return { date, periods, currentPeriod };
}
