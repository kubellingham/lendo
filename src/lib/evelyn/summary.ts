import Decimal from "decimal.js";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { APP_TIMEZONE, addBusinessDays, startOfTodayUtc } from "@/lib/dates";
import {
  REPORT_LOAN_INCLUDE,
  attributeInterest,
  computePeriodMetrics,
  loanRef,
  type LoanFull,
} from "@/lib/reporting";
import { loadCashPool } from "@/lib/cash-pool";
import { interestByMonth, titheFor, type TitheLoan } from "@/lib/tithes";
import { getTitheRatePct } from "@/lib/settings";
import type { LoanStatus } from "@/generated/prisma/enums";

// What Evelyn (the owner's assistant) needs for her morning brief and weekly
// summary, and nothing more: borrower names, loan references, dates and
// amounts. No phone numbers, IDs, addresses or referral details.
//
// Read-only. Statuses are worked out fresh with Lendo's own loan maths
// (computeLoanState + deriveStatuses), so they don't depend on when a loan
// was last opened. A cycle counts as due on its due date and overdue from the
// day after (Lendo's own pages flag it from the start of the due day).

export const SUMMARY_VERSION = 1;
/** Installments due from today up to this many days ahead are listed. */
export const UPCOMING_DAYS = 7;
const MAX_PENDING_TITHES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SummaryLoan = LoanFull & { status: LoanStatus };

export type UpcomingInstallment = {
  loanRef: string;
  borrower: string;
  dueDate: string;
  cycle: number;
  cycles: number;
  finalCycle: boolean;
  /** Interest still to pay for this cycle. */
  interest: string;
  /** Principal due at this cycle (the final cycle only). */
  principal: string;
};

export type OverdueLoan = {
  loanRef: string;
  borrower: string;
  /** missed_cycle: a cycle's interest is late. defaulted: the term is over and principal is still owed. */
  kind: "missed_cycle" | "defaulted";
  since: string;
  daysLate: number;
  /** What it takes to be up to date: late interest, or the full settlement for a defaulted loan. */
  amountDue: string;
  daysPastFinalDate: number;
};

export type WeekFigures = {
  start: string;
  end: string;
  lent: string;
  loansLent: number;
  collected: string;
  interest: string;
  principal: string;
};

export type EvelynSummary = {
  version: typeof SUMMARY_VERSION;
  generatedAt: string;
  timeZone: string;
  currency: "TZS";
  today: string;
  upcoming: UpcomingInstallment[];
  overdue: OverdueLoan[];
  week: WeekFigures;
  previousWeek: WeekFigures;
  totals: {
    /** Principal still with customers, written-off loans excluded (the Capital page's "Out on loan"). */
    outstanding: string;
    overdue: string;
    overdueLoans: number;
    /** Cash on hand from the Capital page. */
    cashAvailable: string;
  };
  tithe: {
    month: string;
    interest: string;
    ratePct: number;
    amount: string;
    submitted: boolean;
    submittedOn: string | null;
    submittedAmount: string | null;
  };
  /** Earlier months whose tithe hasn't been submitted, oldest first. */
  pendingTithes: { month: string; amount: string }[];
};

export type SummaryInput = {
  loans: SummaryLoan[];
  customers: { createdAt: Date }[];
  cashPool: { principalOutstanding: Decimal; cashOnHand: Decimal };
  tithes: {
    ratePct: number;
    submissions: {
      period: string;
      amount: Decimal | string | { toString(): string };
      submittedAt: Date;
    }[];
  };
  /** UTC midnight of today's date in Lendo's time zone (startOfTodayUtc). */
  today: Date;
  now: Date;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const amount = (d: Decimal) => round2(d).toFixed(2);
const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);
const zero = () => new Decimal(0);
const atLeastZero = (d: Decimal) => (d.gt(0) ? d : zero());

function weekFigures(
  input: SummaryInput,
  interestByPayment: Map<string, Decimal>,
  start: Date,
): WeekFigures {
  const end = addBusinessDays(start, 7);
  const m = computePeriodMetrics(
    input.loans,
    input.customers,
    interestByPayment,
    start,
    end,
  );
  return {
    start: iso(start),
    end: iso(addBusinessDays(start, 6)),
    lent: amount(m.disbursed),
    loansLent: m.newLoans,
    collected: amount(m.collected),
    interest: amount(m.interestIncome),
    principal: amount(m.principalCollected),
  };
}

export function buildEvelynSummary(input: SummaryInput): EvelynSummary {
  const { today } = input;
  const upcoming: UpcomingInstallment[] = [];
  const overdue: OverdueLoan[] = [];

  for (const loan of input.loans) {
    if (loan.status === "SETTLED" || loan.status === "WRITTEN_OFF") continue;
    const calc = {
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      cyclesAllowed: loan.cyclesAllowed,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount,
        installmentId: p.installmentId,
      })),
    };
    const state = computeLoanState(calc);
    if (state.principalOutstanding.lte(0)) continue;
    const { installmentStatuses, loanStatus } = deriveStatuses(
      calc,
      state,
      state.currentCycle ?? 1,
      loan.dueAt,
      today,
    );
    const ref = loanRef(loan.id);
    const borrower = loan.customer.fullName;
    const interestLeft = (instId: string) =>
      atLeastZero(
        (state.perInstallmentInterestOwed[instId] ?? zero()).minus(
          state.perInstallmentPaid[instId] ?? zero(),
        ),
      );

    if (loanStatus === "OVERDUE" || loanStatus === "DEFAULTED") {
      const late = loan.installments.filter(
        (i) => installmentStatuses[i.id] === "OVERDUE",
      );
      const defaulted = loanStatus === "DEFAULTED";
      const since = [
        ...late.map((i) => i.dueDate),
        ...(defaulted ? [loan.dueAt] : []),
      ].reduce((a, b) => (b < a ? b : a));
      overdue.push({
        loanRef: ref,
        borrower,
        kind: defaulted ? "defaulted" : "missed_cycle",
        since: iso(since),
        daysLate: Math.max(0, daysBetween(since, today)),
        amountDue: amount(
          defaulted
            ? state.settlementAmountNow
            : late.reduce((sum, i) => sum.plus(interestLeft(i.id)), zero()),
        ),
        daysPastFinalDate: Math.max(0, daysBetween(loan.dueAt, today)),
      });
      // A defaulted loan's whole balance is in the overdue line already.
      if (defaulted) continue;
    }

    for (const inst of loan.installments) {
      const days = daysBetween(today, inst.dueDate);
      if (days < 0 || days > UPCOMING_DAYS) continue;
      if (installmentStatuses[inst.id] === "SETTLED") continue;
      const finalCycle = inst.cycleNumber === loan.cyclesAllowed;
      const interest = interestLeft(inst.id);
      const principal = finalCycle ? state.principalOutstanding : zero();
      if (interest.lte(0) && principal.lte(0)) continue;
      upcoming.push({
        loanRef: ref,
        borrower,
        dueDate: iso(inst.dueDate),
        cycle: inst.cycleNumber,
        cycles: loan.cyclesAllowed,
        finalCycle,
        interest: amount(interest),
        principal: amount(principal),
      });
    }
  }

  upcoming.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.borrower.localeCompare(b.borrower),
  );
  overdue.sort(
    (a, b) => b.daysLate - a.daysLate || a.borrower.localeCompare(b.borrower),
  );

  // Weekly figures with the same sums as the Reports page (Monday to Sunday).
  const interestByPayment = new Map<string, Decimal>();
  for (const loan of input.loans) {
    for (const [id, part] of attributeInterest(loan))
      interestByPayment.set(id, part);
  }
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const weekStart = addBusinessDays(today, -mondayOffset);

  // Tithes, as on the Tithes page.
  const monthly = interestByMonth(input.loans as unknown as TitheLoan[]);
  const { ratePct } = input.tithes;
  const submitted = new Map(input.tithes.submissions.map((s) => [s.period, s]));
  const month = iso(today).slice(0, 7);
  const monthInterest = monthly.get(month) ?? zero();
  const thisMonth = submitted.get(month);
  const pendingTithes = [...monthly.keys()]
    .filter((period) => period < month && !submitted.has(period))
    .sort()
    .map((period) => ({
      month: period,
      amount: titheFor(monthly.get(period) ?? zero(), ratePct),
    }))
    .filter((t) => t.amount.gt(0))
    .slice(-MAX_PENDING_TITHES)
    .map((t) => ({ month: t.month, amount: amount(t.amount) }));

  const overdueTotal = overdue.reduce(
    (sum, o) => sum.plus(money(o.amountDue)),
    zero(),
  );

  return {
    version: SUMMARY_VERSION,
    generatedAt: input.now.toISOString(),
    timeZone: APP_TIMEZONE,
    currency: "TZS",
    today: iso(today),
    upcoming,
    overdue,
    week: weekFigures(input, interestByPayment, weekStart),
    previousWeek: weekFigures(
      input,
      interestByPayment,
      addBusinessDays(weekStart, -7),
    ),
    totals: {
      outstanding: amount(input.cashPool.principalOutstanding),
      overdue: amount(overdueTotal),
      overdueLoans: overdue.length,
      cashAvailable: amount(input.cashPool.cashOnHand),
    },
    tithe: {
      month,
      interest: amount(monthInterest),
      ratePct,
      amount: amount(titheFor(monthInterest, ratePct)),
      submitted: thisMonth !== undefined,
      submittedOn: thisMonth
        ? formatInTimeZone(thisMonth.submittedAt, APP_TIMEZONE, "yyyy-MM-dd")
        : null,
      submittedAmount: thisMonth
        ? amount(money(thisMonth.amount.toString()))
        : null,
    },
    pendingTithes,
  };
}

export async function loadEvelynSummary(
  now = new Date(),
): Promise<EvelynSummary> {
  const [loans, customers, cashPool, ratePct, submissions] = await Promise.all([
    db.loan.findMany({ include: REPORT_LOAN_INCLUDE }),
    db.customer.findMany({ select: { createdAt: true } }),
    loadCashPool(),
    getTitheRatePct(),
    db.tithePayment.findMany({
      select: { period: true, amount: true, submittedAt: true },
    }),
  ]);
  return buildEvelynSummary({
    loans: loans as unknown as SummaryLoan[],
    customers,
    cashPool,
    tithes: { ratePct, submissions },
    today: startOfTodayUtc(),
    now,
  });
}
