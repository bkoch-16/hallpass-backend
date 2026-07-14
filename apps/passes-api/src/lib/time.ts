export function getTodayInTimezone(timezone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
      date,
    );
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const formatted = formatter.format(new Date());
    // Some ICU builds render local midnight as "24:xx" with hour12: false —
    // normalize to "00:xx" so downstream "HH:MM" string comparisons stay valid
    // (mirrors the hour-24 handling in localMidnightAsUTC).
    return formatted.startsWith("24") ? `00${formatted.slice(2)}` : formatted;
  } catch {
    const now = new Date();
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  }
}

function tzOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUTC - date.getTime();
}

// Returns the UTC instant corresponding to local midnight of a "YYYY-MM-DD" date string.
export function localMidnightAsUTC(dateStr: string, timezone: string): Date {
  const targetMidnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  // First guess: offset sampled at noon UTC on the target date. tzOffsetMs uses the full
  // local date-time (including day), so this is exact even for zones beyond UTC+12 where
  // noon UTC already falls on the next local day.
  const guess = targetMidnightUtcMs - tzOffsetMs(new Date(`${dateStr}T12:00:00Z`), timezone);
  // Iterate once: on DST-transition days the offset at local midnight can differ from the
  // offset at the sample instant; re-sampling at the candidate removes the residual error.
  return new Date(targetMidnightUtcMs - tzOffsetMs(new Date(guess), timezone));
}

export function getIntervalStart(interval: string, timezone: string): Date {
  const todayStr = getTodayInTimezone(timezone);
  const [year, month, day] = todayStr.split("-").map(Number);

  if (interval === "DAY") {
    return localMidnightAsUTC(todayStr, timezone);
  }
  if (interval === "WEEK") {
    // dayOfWeek from local date components (0=Sunday)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    // SCHEMA_PLAN: WEEK = current calendar week, Monday 00:00 -> Sunday 23:59
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    // Compute the week-start local DATE via calendar arithmetic, then resolve its
    // midnight in the target timezone (fixed-86.4M-ms subtraction breaks across DST).
    const weekStartStr = new Date(Date.UTC(year, month - 1, day - daysSinceMonday))
      .toISOString()
      .slice(0, 10);
    return localMidnightAsUTC(weekStartStr, timezone);
  }
  // MONTH
  const monthStr = `${year}-${String(month).padStart(2, "0")}-01`;
  return localMidnightAsUTC(monthStr, timezone);
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

/**
 * Build a UTC Date for the period end time in the school's local timezone.
 * Period times are stored as school-local "HH:MM" strings.
 */
export function periodEndDate(
  endTime: string,
  bufferMinutes: number,
  timezone: string,
): Date {
  const [h, m] = endTime.split(":").map(Number);
  const totalMinutes = h * 60 + m + bufferMinutes;
  const daysOverflow = Math.floor(totalMinutes / (24 * 60));
  const remaining = totalMinutes % (24 * 60);

  const todayStr = getTodayInTimezone(timezone);
  let dateStr = todayStr;
  if (daysOverflow > 0) {
    const base = new Date(`${todayStr}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + daysOverflow);
    dateStr = base.toISOString().slice(0, 10);
  }
  const midnight = localMidnightAsUTC(dateStr, timezone);
  return new Date(midnight.getTime() + remaining * 60_000);
}
