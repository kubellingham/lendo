import { addDays, differenceInCalendarDays, format } from "date-fns";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

// The business operates in Tanzania. All "calendar" reasoning (due dates,
// today, day counts) is pinned to Africa/Dar_es_Salaam regardless of where the
// server runs.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Africa/Dar_es_Salaam";

/** "Now" as a Date in the app timezone's wall clock. */
export function nowInTz(): Date {
  return toZonedTime(new Date(), APP_TIMEZONE);
}

/** Start of today (00:00) in the app timezone, as a UTC instant for storage. */
export function startOfTodayUtc(): Date {
  const zoned = nowInTz();
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, APP_TIMEZONE);
}

/**
 * Normalize an arbitrary date to the midnight instant of that calendar day in
 * the app timezone. Used so loan "dates" are stable @db.Date values.
 */
export function toBusinessDate(date: Date): Date {
  const zoned = toZonedTime(date, APP_TIMEZONE);
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, APP_TIMEZONE);
}

/** Add days at the calendar level (DST-safe within the app timezone). */
export function addBusinessDays(date: Date, days: number): Date {
  const zoned = toZonedTime(date, APP_TIMEZONE);
  const next = addDays(zoned, days);
  next.setHours(0, 0, 0, 0);
  return fromZonedTime(next, APP_TIMEZONE);
}

/** Whole calendar days between two dates in the app timezone (b - a). */
export function calendarDaysBetween(a: Date, b: Date): number {
  return differenceInCalendarDays(
    toZonedTime(b, APP_TIMEZONE),
    toZonedTime(a, APP_TIMEZONE),
  );
}

/** Format a date for display, e.g. "29 Jun 2026". */
export function formatDate(date: Date, pattern = "dd MMM yyyy"): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

/** Format a date-time for display, e.g. "29 Jun 2026, 14:05". */
export function formatDateTime(date: Date, pattern = "dd MMM yyyy, HH:mm"): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

/** ISO yyyy-MM-dd in the app timezone (for inputs / CSV). */
export function toIsoDate(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
}

/** Parse a yyyy-MM-dd string (from a date input) to a business date instant. */
export function parseIsoDate(iso: string): Date {
  // Interpret the wall-clock date as midnight in the app timezone.
  return fromZonedTime(`${iso} 00:00:00`, APP_TIMEZONE);
}

export { format };
