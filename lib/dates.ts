import { addDays, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export const APP_TZ = process.env.APP_TIMEZONE || 'Africa/Dar_es_Salaam';

export function addDaysUTC(date: Date, days: number): Date {
  return addDays(date, days);
}

export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, APP_TZ, 'dd MMM yyyy');
}

export function fmtDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, APP_TZ, 'dd MMM yyyy HH:mm');
}

export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export { format };
