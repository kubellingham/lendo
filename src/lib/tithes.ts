import Decimal from "decimal.js";
import { formatInTimeZone } from "date-fns-tz";
import { computeLoanState, type CalcInstallment } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { APP_TIMEZONE } from "@/lib/dates";
import type { LoanStatus } from "@/generated/prisma/enums";

export const DEFAULT_TITHE_RATE_PCT = 10;

export type TitheLoan = {
  principal: Decimal | string;
  status: LoanStatus;
  interestRatePct?: number;
  installments: CalcInstallment[];
  payments: {
    id: string;
    amount: Decimal | string;
    installmentId: string | null;
    paidAt: Date;
    createdAt: Date;
  }[];
};

/**
 * Attribute the interest (profit) portion of every payment and total it by
 * calendar month ("YYYY-MM" in the app timezone).
 *
 * Interest is always covered before principal within a cycle (matching the
 * reducing-balance model). For each installment we take its interest owed
 * (from computeLoanState, which already accounts for early principal paydown),
 * then walk that cycle's payments in chronological order, counting each
 * payment's contribution to the still-uncovered interest as profit.
 */
export function interestByMonth(loans: TitheLoan[]): Map<string, Decimal> {
  const byMonth = new Map<string, Decimal>();

  const addTo = (period: string, amount: Decimal) => {
    byMonth.set(period, (byMonth.get(period) ?? new Decimal(0)).plus(amount));
  };

  for (const loan of loans) {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount,
        installmentId: p.installmentId,
      })),
    });

    // Group payments by the installment (cycle) they were applied to.
    const byInstallment = new Map<string, TitheLoan["payments"]>();
    for (const p of loan.payments) {
      const key = p.installmentId ?? "__unallocated__";
      const list = byInstallment.get(key) ?? [];
      list.push(p);
      byInstallment.set(key, list);
    }

    for (const [instId, payments] of byInstallment) {
      // Unallocated payments carry no interest for tithe purposes.
      let remainingInterest =
        instId === "__unallocated__"
          ? new Decimal(0)
          : (state.perInstallmentInterestOwed[instId] ?? new Decimal(0));

      const ordered = [...payments].sort((a, b) => {
        const t = a.paidAt.getTime() - b.paidAt.getTime();
        return t !== 0 ? t : a.createdAt.getTime() - b.createdAt.getTime();
      });

      for (const p of ordered) {
        const amt = money(p.amount);
        const interestPart = Decimal.min(amt, remainingInterest);
        remainingInterest = remainingInterest.minus(interestPart);
        if (interestPart.gt(0)) {
          const period = formatInTimeZone(p.paidAt, APP_TIMEZONE, "yyyy-MM");
          addTo(period, interestPart);
        }
      }
    }
  }

  // Round each month once at the end.
  for (const [period, value] of byMonth) {
    byMonth.set(period, round2(value));
  }
  return byMonth;
}

/** Human label for a "YYYY-MM" period, e.g. "July 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return formatInTimeZone(d, APP_TIMEZONE, "MMMM yyyy");
}

/** Every month from `earliest` to the current month (inclusive), newest first. */
export function monthsRange(earliest: string | null): string[] {
  const now = new Date();
  const current = formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM");
  const start = earliest && earliest < current ? earliest : current;
  const [sy, sm] = start.split("-").map(Number);
  const [cy, cm] = current.split("-").map(Number);

  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < cy || (y === cy && m <= cm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.reverse();
}
