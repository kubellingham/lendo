import Decimal from "decimal.js";

// All currency math goes through decimal.js. Never use JS `number` for money.
// Amounts are Tanzanian Shillings (TZS) with 2 decimal places.

// TZS has no sub-unit in everyday use, but we keep 2 dp for interest precision.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal | string | number | { toString(): string };

export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value.toString());
}

export function add(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function subtract(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function multiply(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

/** Percentage of an amount, e.g. percentOf(100000, 15) -> 15000. */
export function percentOf(amount: MoneyInput, pct: MoneyInput): Decimal {
  return money(amount).times(money(pct)).dividedBy(100);
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative();
}

export function isZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gte(money(b));
}

export function lte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lte(money(b));
}

/** Round to 2 decimal places and return a Decimal. */
export function round2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2);
}

/** Canonical string for persistence (always 2 dp). */
export function toDbString(value: MoneyInput): string {
  return round2(value).toFixed(2);
}

const tzsFormatter = new Intl.NumberFormat("en-TZ", {
  style: "currency",
  currency: "TZS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Display a TZS amount, e.g. "TZS 100,000". */
export function formatTZS(value: MoneyInput): string {
  return tzsFormatter.format(money(value).toNumber());
}

/** Display a number without the currency symbol, e.g. "100,000.00". */
export function formatAmount(value: MoneyInput, dp = 2): string {
  return new Intl.NumberFormat("en-TZ", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(money(value).toNumber());
}
