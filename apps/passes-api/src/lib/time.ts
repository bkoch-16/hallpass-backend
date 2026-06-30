/**
 * Parse a period endTime string ("HH:MM") and apply a buffer in minutes,
 * returning a UTC Date for today. Period times are stored in UTC.
 */
export function periodEndDate(endTime: string, bufferMinutes: number): Date {
  const [hours, minutes] = endTime.split(':').map(Number);
  const date = new Date();
  date.setUTCHours(hours, minutes + bufferMinutes, 0, 0);
  return date;
}
