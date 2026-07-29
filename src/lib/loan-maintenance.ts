import { db } from "@/lib/db";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { money, round2, toDbString } from "@/lib/money";
import { addBusinessDays, startOfTodayUtc, nowInTz } from "@/lib/dates";
import type { InstallmentStatus } from "@/generated/prisma/enums";

// A loan runs for its agreed cycles (3 × 30 days by default). If it isn't
// cleared by then, we keep charging interest at the same rate on the
// remaining principal for each additional 30-day period until it's paid off —
// so a defaulted borrower who keeps paying is billed correctly month after
// month. We cap the extension so a very old unpaid loan can't grow unbounded.
const MAX_CYCLES = 36;

/**
 * How many cycles a loan should currently have: never fewer than the agreed
 * term, one more for each additional 30-day period that has started since
 * disbursal, capped at MAX_CYCLES. Pure so it is unit-testable.
 */
export function neededCycleCount(
  disbursedAt: Date,
  today: Date,
  cycleDays: number,
  cyclesAllowed: number,
): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.floor((today.getTime() - disbursedAt.getTime()) / dayMs);
  const started = Math.floor(Math.max(0, daysSince) / cycleDays) + 1;
  return Math.max(cyclesAllowed, Math.min(started, MAX_CYCLES));
}

/**
 * Ensure a loan has all the cycles it should, adding new 30-day cycles past the
 * agreed term while principal remains outstanding, then recompute statuses and
 * the reducing-balance interest. Idempotent — safe to call on every view/payment.
 */
export async function ensureLoanCycles(loanId: string): Promise<void> {
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: { select: { amount: true, installmentId: true } },
    },
  });
  if (!loan) return;
  if (loan.status === "SETTLED" || loan.status === "WRITTEN_OFF") return;

  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: loan.payments,
  });
  // Fully paid down — no need to keep extending.
  if (state.principalOutstanding.lte(0)) {
    await recomputeLoan(loanId);
    return;
  }

  const today = startOfTodayUtc();
  const need = neededCycleCount(
    loan.disbursedAt,
    today,
    loan.cycleDays,
    loan.cyclesAllowed,
  );
  const existingMax = loan.installments.reduce(
    (m, i) => Math.max(m, i.cycleNumber),
    0,
  );

  if (need > existingMax) {
    const rate = money(loan.interestRatePct).div(100);
    const rows = [];
    for (let c = existingMax + 1; c <= need; c++) {
      rows.push({
        loanId: loan.id,
        cycleNumber: c,
        dueDate: addBusinessDays(loan.disbursedAt, loan.cycleDays * c),
        // Placeholder; recomputeLoan writes the reducing-balance figure below.
        expectedInterest: toDbString(round2(money(loan.principal).times(rate))),
        expectedPrincipalAtThisCycle: "0",
      });
    }
    await db.installment.createMany({ data: rows });
  }

  await recomputeLoan(loanId);
}

/**
 * Recompute installment statuses + per-cycle interest and the loan status from
 * the current payments, and persist any changes. Shared by cycle extension and
 * the nightly job.
 */
export async function recomputeLoan(loanId: string): Promise<void> {
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: { select: { amount: true, installmentId: true } },
    },
  });
  if (!loan) return;
  if (loan.status === "WRITTEN_OFF") return;

  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: loan.payments,
  });
  const now = nowInTz();
  const { installmentStatuses, loanStatus } = deriveStatuses(
    {
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      cyclesAllowed: loan.cyclesAllowed,
      installments: loan.installments,
      payments: [],
    },
    state,
    state.currentCycle ?? 1,
    loan.dueAt,
    now,
  );

  await db.$transaction(async (tx) => {
    for (const inst of loan.installments) {
      const status = installmentStatuses[inst.id] as InstallmentStatus;
      const newInterest = state.perInstallmentInterestOwed[inst.id];
      const data: { status?: InstallmentStatus; expectedInterest?: string } = {};
      if (status !== inst.status) data.status = status;
      if (
        newInterest &&
        newInterest.toFixed(2) !== inst.expectedInterest.toString()
      ) {
        data.expectedInterest = newInterest.toFixed(2);
      }
      if (Object.keys(data).length > 0) {
        await tx.installment.update({ where: { id: inst.id }, data });
      }
    }
    if (loanStatus !== loan.status) {
      await tx.loan.update({ where: { id: loan.id }, data: { status: loanStatus } });
    }
  });
}
