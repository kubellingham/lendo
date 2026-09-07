import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { getTitheRatePct } from "@/lib/settings";
import type { RiskBand } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Period report data. Computes a period's activity + an end-of-period snapshot,
// plus the same for the previous period so the PDF can show deltas.
// ---------------------------------------------------------------------------

export type PeriodType = "month" | "quarter" | "year";
export type PeriodSpec = {
  type: PeriodType;
  year: number;
  month?: number; // 1–12 for month
  quarter?: number; // 1–4 for quarter
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** UTC [start, end) range for a period, its label, and the previous period. */
export function periodRange(spec: PeriodSpec): {
  start: Date;
  end: Date;
  label: string;
  prev: PeriodSpec;
} {
  if (spec.type === "month") {
    const m = spec.month ?? 1;
    const start = new Date(Date.UTC(spec.year, m - 1, 1));
    const end = new Date(Date.UTC(spec.year, m, 1));
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? spec.year - 1 : spec.year;
    return {
      start,
      end,
      label: `${MONTHS[m - 1]} ${spec.year}`,
      prev: { type: "month", year: prevY, month: prevM },
    };
  }
  if (spec.type === "quarter") {
    const q = spec.quarter ?? 1;
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(spec.year, startMonth, 1));
    const end = new Date(Date.UTC(spec.year, startMonth + 3, 1));
    const prevQ = q === 1 ? 4 : q - 1;
    const prevY = q === 1 ? spec.year - 1 : spec.year;
    return {
      start,
      end,
      label: `Q${q} ${spec.year}`,
      prev: { type: "quarter", year: prevY, quarter: prevQ },
    };
  }
  const start = new Date(Date.UTC(spec.year, 0, 1));
  const end = new Date(Date.UTC(spec.year + 1, 0, 1));
  return {
    start,
    end,
    label: `${spec.year}`,
    prev: { type: "year", year: spec.year - 1 },
  };
}

type LoanFull = {
  id: string;
  principal: Decimal;
  interestRatePct: number;
  cyclesAllowed: number;
  disbursedAt: Date;
  dueAt: Date;
  installments: {
    id: string;
    cycleNumber: number;
    dueDate: Date;
    expectedInterest: Decimal;
    expectedPrincipalAtThisCycle: Decimal;
    status: "PENDING" | "INTEREST_PAID" | "SETTLED" | "OVERDUE";
  }[];
  payments: {
    id: string;
    amount: Decimal;
    installmentId: string | null;
    paidAt: Date;
    createdAt: Date;
    installment: { dueDate: Date } | null;
  }[];
};

/** Interest portion of each payment (interest is covered before principal). */
function attributeInterest(loan: LoanFull): Map<string, Decimal> {
  const state = computeLoanState({
    principal: loan.principal,
    status: "ACTIVE",
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: loan.payments.map((p) => ({
      amount: p.amount,
      installmentId: p.installmentId,
    })),
  });
  const out = new Map<string, Decimal>();
  const byInst = new Map<string, LoanFull["payments"]>();
  for (const p of loan.payments) {
    const key = p.installmentId ?? "__none__";
    (byInst.get(key) ?? byInst.set(key, []).get(key)!).push(p);
  }
  for (const [instId, pmts] of byInst) {
    let remaining =
      instId === "__none__"
        ? new Decimal(0)
        : (state.perInstallmentInterestOwed[instId] ?? new Decimal(0));
    const ordered = [...pmts].sort(
      (a, b) =>
        a.paidAt.getTime() - b.paidAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const p of ordered) {
      const part = Decimal.min(money(p.amount), remaining);
      remaining = remaining.minus(part);
      out.set(p.id, part);
    }
  }
  return out;
}

export type PeriodMetrics = {
  disbursed: Decimal;
  collected: Decimal;
  interestIncome: Decimal;
  principalCollected: Decimal;
  newLoans: number;
  newCustomers: number;
  onTimeRatePct: number | null;
  outstanding: Decimal; // at period end
  activeLoans: number; // at period end
  defaultRatePct: number | null; // at period end
};

export type ReportData = {
  label: string;
  prevLabel: string;
  start: Date;
  end: Date;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  trend: { label: string; disbursed: number; collected: number }[];
  aging: { label: string; count: number; amount: Decimal }[];
  risk: { band: RiskBand; count: number }[];
  cashPool: {
    periodIn: Decimal;
    periodOut: Decimal;
    capitalRaised: Decimal;
    disbursed: Decimal;
    capitalRepaid: Decimal;
    cashOnHand: Decimal; // cumulative at end
  };
  tithes: { interest: Decimal; ratePct: number; tithe: Decimal };
};

const AGING_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: "Current", min: -Infinity, max: 0 },
  { label: "1–30 days", min: 1, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "90+ days", min: 91, max: null },
];

const DAY = 24 * 60 * 60 * 1000;

export async function buildReportData(spec: PeriodSpec): Promise<ReportData> {
  const { start, end, label, prev } = periodRange(spec);
  const prevRange = periodRange(prev);

  const [loansRaw, customers, capital, capitalRepayments, tithePayments, titheRate] =
    await Promise.all([
      db.loan.findMany({
        include: {
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: {
            select: {
              id: true,
              amount: true,
              installmentId: true,
              paidAt: true,
              createdAt: true,
              installment: { select: { dueDate: true } },
            },
          },
        },
      }),
      db.customer.findMany({
        select: { id: true, createdAt: true, riskBand: true },
      }),
      db.capitalSource.findMany({ select: { amount: true, receivedAt: true } }),
      db.capitalRepayment.findMany({ select: { amount: true, paidAt: true } }),
      db.tithePayment.findMany({ select: { period: true, amount: true } }),
      getTitheRatePct(),
    ]);

  const loans = loansRaw as unknown as LoanFull[];
  const interestByPayment = new Map<string, Decimal>();
  for (const loan of loans) {
    for (const [pid, amt] of attributeInterest(loan)) interestByPayment.set(pid, amt);
  }

  function metrics(pStart: Date, pEnd: Date): PeriodMetrics {
    let disbursed = money(0);
    let collected = money(0);
    let interestIncome = money(0);
    let onTime = 0;
    let latePmt = 0;
    let newLoans = 0;
    let outstanding = money(0);
    let activeLoans = 0;
    let defaultedAtEnd = 0;
    let loansAtEnd = 0;

    for (const loan of loans) {
      if (loan.disbursedAt >= pStart && loan.disbursedAt < pEnd) {
        disbursed = disbursed.plus(money(loan.principal));
        newLoans++;
      }
      for (const p of loan.payments) {
        if (p.paidAt >= pStart && p.paidAt < pEnd) {
          collected = collected.plus(money(p.amount));
          interestIncome = interestIncome.plus(
            interestByPayment.get(p.id) ?? new Decimal(0),
          );
          if (p.installment) {
            const diff = Math.round(
              (Date.UTC(
                p.paidAt.getUTCFullYear(),
                p.paidAt.getUTCMonth(),
                p.paidAt.getUTCDate(),
              ) -
                Date.UTC(
                  p.installment.dueDate.getUTCFullYear(),
                  p.installment.dueDate.getUTCMonth(),
                  p.installment.dueDate.getUTCDate(),
                )) /
                DAY,
            );
            if (diff > 0) latePmt++;
            else onTime++;
          }
        }
      }

      // End-of-period snapshot for loans disbursed by then.
      if (loan.disbursedAt < pEnd) {
        loansAtEnd++;
        const priorPayments = loan.payments
          .filter((p) => p.paidAt < pEnd)
          .map((p) => ({ amount: p.amount, installmentId: p.installmentId }));
        const st = computeLoanState({
          principal: loan.principal,
          status: "ACTIVE",
          interestRatePct: loan.interestRatePct,
          installments: loan.installments,
          payments: priorPayments,
        });
        if (st.principalOutstanding.gt(0)) {
          outstanding = outstanding.plus(st.principalOutstanding);
          activeLoans++;
          if (loan.dueAt < pEnd) defaultedAtEnd++; // past due by period end, still owing
        }
      }
    }

    const totalPmt = onTime + latePmt;
    return {
      disbursed: round2(disbursed),
      collected: round2(collected),
      interestIncome: round2(interestIncome),
      principalCollected: round2(collected.minus(interestIncome)),
      newLoans,
      newCustomers: customers.filter(
        (c) => c.createdAt >= pStart && c.createdAt < pEnd,
      ).length,
      onTimeRatePct: totalPmt > 0 ? Math.round((onTime / totalPmt) * 100) : null,
      outstanding: round2(outstanding),
      activeLoans,
      defaultRatePct:
        loansAtEnd > 0 ? Math.round((defaultedAtEnd / loansAtEnd) * 100) : null,
    };
  }

  const current = metrics(start, end);
  const previous = metrics(prevRange.start, prevRange.end);

  // 6-month trend ending at the period end.
  const trend: ReportData["trend"] = [];
  for (let i = 5; i >= 0; i--) {
    const mEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const mStart = new Date(
      Date.UTC(mEnd.getUTCFullYear(), mEnd.getUTCMonth() - 1, 1),
    );
    let d = money(0);
    let c = money(0);
    for (const loan of loans) {
      if (loan.disbursedAt >= mStart && loan.disbursedAt < mEnd)
        d = d.plus(money(loan.principal));
      for (const p of loan.payments)
        if (p.paidAt >= mStart && p.paidAt < mEnd) c = c.plus(money(p.amount));
    }
    trend.push({
      label: `${MONTHS[mStart.getUTCMonth()].slice(0, 3)}`,
      disbursed: d.toNumber(),
      collected: c.toNumber(),
    });
  }

  // Aging at period end.
  const aging = AGING_BUCKETS.map((b) => ({ label: b.label, count: 0, amount: money(0) }));
  for (const loan of loans) {
    if (loan.disbursedAt >= end) continue;
    const prior = loan.payments
      .filter((p) => p.paidAt < end)
      .map((p) => ({ amount: p.amount, installmentId: p.installmentId }));
    const st = computeLoanState({
      principal: loan.principal,
      status: "ACTIVE",
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: prior,
    });
    if (st.principalOutstanding.lte(0)) continue;
    const daysLate =
      end > loan.dueAt
        ? Math.floor((end.getTime() - loan.dueAt.getTime()) / DAY)
        : 0;
    const bucket =
      aging.find((_, i) => {
        const b = AGING_BUCKETS[i];
        return (
          (b.min === -Infinity || daysLate >= b.min) &&
          (b.max === null || daysLate <= b.max)
        );
      }) ?? aging[0];
    bucket.count++;
    bucket.amount = bucket.amount.plus(st.principalOutstanding);
  }

  // Current risk distribution (latest scores).
  const riskOrder: RiskBand[] = [
    "EXCELLENT", "GOOD", "WATCH", "HIGH_RISK", "CRITICAL",
  ];
  const riskCounts = new Map<RiskBand, number>();
  for (const c of customers)
    riskCounts.set(c.riskBand, (riskCounts.get(c.riskBand) ?? 0) + 1);
  const risk = riskOrder.map((band) => ({ band, count: riskCounts.get(band) ?? 0 }));

  // Cash pool.
  const capitalRaisedPeriod = capital
    .filter((c) => c.receivedAt >= start && c.receivedAt < end)
    .reduce((a, c) => a.plus(money(c.amount)), money(0));
  const capitalRepaidPeriod = capitalRepayments
    .filter((r) => r.paidAt >= start && r.paidAt < end)
    .reduce((a, r) => a.plus(money(r.amount)), money(0));
  const tithesInPeriod = tithePayments
    .filter((t) => t.period >= monthKey(start) && t.period < monthKey(end))
    .reduce((a, t) => a.plus(money(t.amount)), money(0));

  const capitalRaisedToEnd = capital
    .filter((c) => c.receivedAt < end)
    .reduce((a, c) => a.plus(money(c.amount)), money(0));
  const collectedToEnd = loans
    .flatMap((l) => l.payments)
    .filter((p) => p.paidAt < end)
    .reduce((a, p) => a.plus(money(p.amount)), money(0));
  const disbursedToEnd = loans
    .filter((l) => l.disbursedAt < end)
    .reduce((a, l) => a.plus(money(l.principal)), money(0));
  const capitalRepaidToEnd = capitalRepayments
    .filter((r) => r.paidAt < end)
    .reduce((a, r) => a.plus(money(r.amount)), money(0));
  const tithesToEnd = tithePayments
    .filter((t) => t.period < monthKey(end))
    .reduce((a, t) => a.plus(money(t.amount)), money(0));
  const cashOnHand = capitalRaisedToEnd
    .plus(collectedToEnd)
    .minus(disbursedToEnd)
    .minus(capitalRepaidToEnd)
    .minus(tithesToEnd);

  const periodIn = capitalRaisedPeriod.plus(current.collected);
  const periodOut = current.disbursed
    .plus(capitalRepaidPeriod)
    .plus(tithesInPeriod);

  return {
    label,
    prevLabel: prevRange.label,
    start,
    end,
    current,
    previous,
    trend,
    aging,
    risk,
    cashPool: {
      periodIn: round2(periodIn),
      periodOut: round2(periodOut),
      capitalRaised: round2(capitalRaisedPeriod),
      disbursed: current.disbursed,
      capitalRepaid: round2(capitalRepaidPeriod),
      cashOnHand: round2(cashOnHand),
    },
    tithes: {
      interest: current.interestIncome,
      ratePct: titheRate,
      tithe: round2(current.interestIncome.times(titheRate).div(100)),
    },
  };
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
