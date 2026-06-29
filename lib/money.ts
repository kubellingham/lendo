import Decimal from 'decimal.js';

export type Money = Decimal;

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value ?? 0);
}

export function formatTZS(value: Decimal.Value | null | undefined): string {
  const d = money(value ?? 0);
  return new Intl.NumberFormat('en-TZ', {
    style: 'currency',
    currency: 'TZS',
    maximumFractionDigits: 0,
  }).format(Number(d.toFixed(2)));
}

export function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), money(0));
}
