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
    return formatter.format(new Date());
  } catch {
    const now = new Date();
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  }
}

// Returns the UTC instant corresponding to local midnight of a "YYYY-MM-DD" date string.
export function localMidnightAsUTC(dateStr: string, timezone: string): Date {
  // Noon UTC is always on the correct local calendar date for any timezone (UTC-12 to UTC+14),
  // unlike midnight UTC which lands on the previous local date for UTC- timezones.
  const approxUtc = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(approxUtc);
  const rawH = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const localM = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const localH = rawH === 24 ? 0 : rawH;
  return new Date(approxUtc.getTime() - (localH * 60 + localM) * 60_000);
}

export function getIntervalStart(interval: string, timezone: string): Date {
  const todayStr = getTodayInTimezone(timezone);
  const [year, month, day] = todayStr.split("-").map(Number);

  if (interval === "DAY") {
    return localMidnightAsUTC(todayStr, timezone);
  }
  if (interval === "WEEK") {
    const todayMidnight = localMidnightAsUTC(todayStr, timezone);
    // dayOfWeek from local date components (0=Sunday)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return new Date(todayMidnight.getTime() - dayOfWeek * 86_400_000);
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
