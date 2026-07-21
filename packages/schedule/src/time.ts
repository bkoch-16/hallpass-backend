// Pure timezone/time-string helpers backing the schedule resolver. These are
// intentionally self-contained copies of the equivalent helpers in
// apps/passes-api/src/lib/time.ts (which also has unrelated calendar/interval
// helpers that resolveSchedule does not need) — this package must stay
// DB-free and dependency-free, and both variants take an injectable `now`.

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

/** Add minutes to a zero-padded "HH:MM" string. Wraps at 24 h. */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const clampedH = ((Math.floor(total / 60) % 24) + 24) % 24;
  const clampedM = ((total % 60) + 60) % 60;
  return `${String(clampedH).padStart(2, "0")}:${String(clampedM).padStart(2, "0")}`;
}

/**
 * Add minutes to a zero-padded "HH:MM" string, clamping at "00:00" instead of
 * wrapping. Use for buffered window STARTS — wrapping a start past midnight
 * (e.g. "00:05" − 10 min → "23:55") produces a window that can never match.
 */
export function addMinutesToTimeClamped(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.max(0, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** UTC-midnight Date for a "YYYY-MM-DD" calendar date string. */
export function calendarDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}
