import { addDays, differenceInCalendarDays, format } from "date-fns";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

// The business operates in Tanzania (Africa/Dar_es_Salaam, UTC+3, no DST).
//
// We deliberately treat user-typed calendar dates (yyyy-MM-dd from a date
// input, loan disbursal date, payment date, installment due date) as
// **UTC midnight of that calendar day**, end to end. That makes them stable
// across Postgres `@db.Date`, the pg adapter, and display formatting:
//
//   user types  "2026-05-01"
//   stored      Date(2026-05-01T00:00:00.000Z) -> Postgres DATE "2026-05-01"
//   read back   Date(2026-05-01T00:00:00.000Z)
//   formatted   formatInTimeZone(d, TZ, "dd MMM yyyy") -> "01 May 2026"
//
// Previous code shifted the user-typed date back 3h with fromZonedTime, which
// rounded down to the previous day when stored as @db.Date.

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Africa/Dar_es_Salaam";

/** "Now" as a Date in the app timezone's wall clock (still a real Date). */
export function nowInTz(): Date {
  return toZonedTime(new Date(), APP_TIMEZONE);
}

/** Start of today (00:00) in the app timezone, as a UTC instant. */
export function startOfTodayUtc(): Date {
  const ymd = formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Normalize an arbitrary date/instant to UTC midnight of its calendar day in
 * the app timezone. Used so loan "dates" are stable `@db.Date` values.
 */
export function toBusinessDate(date: Date): Date {
  const ymd = formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Add whole calendar days to a business date (UTC-midnight in / out). */
export function addBusinessDays(date: Date, days: number): Date {
  const base = toBusinessDate(date);
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  // Snap back to UTC midnight in case of any leap-second weirdness.
  const ymd = next.toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00.000Z`);
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
export function formatDateTime(
  date: Date,
  pattern = "dd MMM yyyy, HH:mm",
): string {
  return formatInTimeZone(date, APP_TIMEZONE, pattern);
}

/** ISO yyyy-MM-dd in the app timezone (for inputs / CSV). */
export function toIsoDate(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-dd");
}

/** Parse a yyyy-MM-dd string from a date input to UTC midnight of that day. */
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// Re-export so callers don't need a separate import for the simple cases.
export { format, fromZonedTime };
