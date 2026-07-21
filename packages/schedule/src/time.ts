// Pure timezone/time-string helpers backing the schedule resolver. This package is
// the single source of these helpers — apps/passes-api re-exports them from here.
// Must stay DB-free and dependency-free; all helpers take an injectable `now`.

/** School-local calendar date ("YYYY-MM-DD") for a given instant. */
export function getTodayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** School-local wall-clock time ("HH:MM", 24h) for a given instant. */
export function getCurrentTimeInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const formatted = formatter.format(now);
    // Some ICU builds render local midnight as "24:xx" with hour12: false —
    // normalize to "00:xx" so downstream "HH:MM" string comparisons stay valid.
    return formatted.startsWith("24") ? `00${formatted.slice(2)}` : formatted;
  } catch {
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/**
 * Add minutes to a zero-padded "HH:MM" string, clamping to the same day
 * ("00:00".."23:59") instead of wrapping. Wrapping produces buffered windows
 * that can never match: a window START before midnight would wrap to "23:xx"
 * (e.g. "00:05" - 10 min), and a window END past midnight would wrap to
 * "00:xx" (e.g. "23:55" + 10 min) — both make windowStart <= t <= windowEnd
 * unsatisfiable for every in-period time.
 */
export function addMinutesToTimeClamped(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** UTC-midnight Date for a "YYYY-MM-DD" calendar date string. */
export function calendarDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}
