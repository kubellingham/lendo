import Decimal from "decimal.js";
import { add, money, round2, subtract } from "@/lib/money";
import type { InstallmentStatus, LoanStatus } from "@/generated/prisma/enums";

// Reducing-balance allocation model:
//   Each cycle's interest is 15% of the *outstanding principal at the start
//   of that cycle*. Interest is charged fresh each cycle (simple, not
//   compounding). A payment applied to a cycle covers that cycle's interest
//   first; any surplus reduces principal, which lowers the interest owed for
//   every subsequent cycle. Once principal reaches zero the loan is SETTLED.
//
// Example (Rashid): P = 1,000,000 issued.
//   Cycle 1 interest owed = 150,000. Rashid pays 550,000.
//     → 150,000 covers interest. 400,000 pays down principal.
//     → Opening principal for cycle 2 = 600,000. Cycle 2 interest = 90,000.

export interface CalcInstallment {
  id: string;
  cycleNumber: number;
  dueDate: Date;
  expectedInterest: Decimal | string;
  expectedPrincipalAtThisCycle: Decimal | string;
  status: InstallmentStatus;
}

export interface CalcPayment {
  amount: Decimal | string;
  installmentId: string | null;
}

export interface LoanStateInput {
  principal: Decimal | string;
  status: LoanStatus;
  interestRatePct?: Decimal | string | number;
  /** Agreed number of cycles (default term). Used to decide when the final
   *  cycle has been reached for default detection. */
  cyclesAllowed?: number;
  installments: CalcInstallment[];
  payments: CalcPayment[];
}

export interface LoanState {
  principal: Decimal;
  ratePct: Decimal;
  totalCollected: Decimal;
  interestCollected: Decimal;
  principalCollected: Decimal;
  principalOutstanding: Decimal;
  /** Amount required to fully settle the loan right now (principal + this cycle's remaining interest). */
  settlementAmountNow: Decimal;
  /** Interest-only amount to roll the current cycle. */
  interestOnlyNow: Decimal;
  /** Cycle number currently due (earliest unsettled), or null if settled. */
  currentCycle: number | null;
  isSettled: boolean;
  perInstallmentPaid: Record<string, Decimal>;
  /** Interest recomputed per cycle under the reducing-balance rule. */
  perInstallmentInterestOwed: Record<string, Decimal>;
  /** Principal outstanding at the start of each cycle. */
  perInstallmentOpeningPrincipal: Record<string, Decimal>;
}

export interface DerivedStatuses {
  installmentStatuses: Record<string, InstallmentStatus>;
  loanStatus: LoanStatus;
  settled: boolean;
}

/**
 * Given the loan state *after* a projected payment, derive the new installment
 * statuses and overall loan status. Pure (no I/O) so it is unit-testable and
 * shared by the record-payment action and the nightly recompute job.
 */
export function deriveStatuses(
  loan: LoanStateInput,
  state: LoanState,
  targetCycle: number,
  loanDueAt: Date,
  now: Date,
): DerivedStatuses {
  const settled = state.principalOutstanding.lte(0);
  const installmentStatuses: Record<string, InstallmentStatus> = {};

  for (const inst of loan.installments) {
    const paid = state.perInstallmentPaid[inst.id] ?? new Decimal(0);
    const interestOwed =
      state.perInstallmentInterestOwed[inst.id] ?? new Decimal(0);
    let status: InstallmentStatus;
    if (settled) {
      status =
        inst.cycleNumber >= targetCycle
          ? "SETTLED"
          : paid.gte(interestOwed)
            ? "INTEREST_PAID"
            : "SETTLED";
    } else if (interestOwed.gt(0) && paid.gte(interestOwed)) {
      status = "INTEREST_PAID";
    } else if (interestOwed.eq(0)) {
      // Cycle carries no interest (principal already zero) — nothing to owe.
      status = "SETTLED";
    } else if (now.getTime() > inst.dueDate.getTime()) {
      status = "OVERDUE";
    } else {
      status = "PENDING";
    }
    installmentStatuses[inst.id] = status;
  }

  // The final allowed cycle of the original term (default 3). On this cycle the
  // borrower is expected to settle in full — the principal was due.
  const finalCycle = loan.cyclesAllowed ?? loan.installments.length;

  let loanStatus: LoanStatus;
  if (settled) {
    loanStatus = "SETTLED";
  } else if (now.getTime() > loanDueAt.getTime()) {
    loanStatus = "DEFAULTED";
  } else if (
    // Reached the final (or an extended) cycle and only paid its interest
    // without clearing the principal — the term is used up, so this is a
    // default even before the calendar due date passes.
    loan.installments.some(
      (inst) =>
        inst.cycleNumber >= finalCycle &&
        installmentStatuses[inst.id] === "INTEREST_PAID",
    )
  ) {
    loanStatus = "DEFAULTED";
  } else {
    const anyOverdue = loan.installments.some(
      (inst) => installmentStatuses[inst.id] === "OVERDUE",
    );
    loanStatus = anyOverdue ? "OVERDUE" : "ACTIVE";
  }

  return { installmentStatuses, loanStatus, settled };
}

export function computeLoanState(loan: LoanStateInput): LoanState {
  const principal = round2(loan.principal);
  const ratePct = money(loan.interestRatePct ?? 15);
  const rateFrac = ratePct.div(100);

  const sortedInstallments = [...loan.installments].sort(
    (a, b) => a.cycleNumber - b.cycleNumber,
  );

  // Bucket payments by installment.
  const perInstallmentPaid: Record<string, Decimal> = {};
  for (const inst of sortedInstallments) perInstallmentPaid[inst.id] = new Decimal(0);
  let unallocated = new Decimal(0);
  let totalCollected = new Decimal(0);
  for (const p of loan.payments) {
    const amt = money(p.amount);
    totalCollected = totalCollected.plus(amt);
    if (p.installmentId && perInstallmentPaid[p.installmentId] !== undefined) {
      perInstallmentPaid[p.installmentId] = perInstallmentPaid[p.installmentId].plus(amt);
    } else {
      unallocated = unallocated.plus(amt);
    }
  }
  totalCollected = round2(totalCollected);

  // Walk cycles in order, applying reducing-balance interest.
  const perInstallmentInterestOwed: Record<string, Decimal> = {};
  const perInstallmentOpeningPrincipal: Record<string, Decimal> = {};
  let openingPrincipal = principal;
  let principalCollected = new Decimal(0);
  let interestCollected = new Decimal(0);

  for (const inst of sortedInstallments) {
    const cycleInterest = round2(openingPrincipal.times(rateFrac));
    perInstallmentInterestOwed[inst.id] = cycleInterest;
    perInstallmentOpeningPrincipal[inst.id] = openingPrincipal;

    const paid = perInstallmentPaid[inst.id];
    // Interest gets covered first.
    const interestPaidThisCycle = Decimal.min(paid, cycleInterest);
    interestCollected = interestCollected.plus(interestPaidThisCycle);
    // Surplus (if any) reduces principal.
    const principalPaidThisCycle = Decimal.max(0, paid.minus(cycleInterest));
    const applied = Decimal.min(principalPaidThisCycle, openingPrincipal);
    principalCollected = principalCollected.plus(applied);
    openingPrincipal = openingPrincipal.minus(applied);
    if (openingPrincipal.lte(0)) openingPrincipal = new Decimal(0);
  }

  // Unallocated payments reduce principal after each cycle's interest is
  // covered above — they don't produce extra interest by themselves.
  if (unallocated.gt(0)) {
    const applied = Decimal.min(unallocated, openingPrincipal);
    principalCollected = principalCollected.plus(applied);
    openingPrincipal = openingPrincipal.minus(applied);
  }

  const principalOutstanding = round2(subtract(principal, principalCollected));
  const isSettled = loan.status === "SETTLED" || principalOutstanding.lte(0);

  // Current cycle = earliest cycle whose interest isn't yet fully paid and
  // whose interest owed is > 0 (i.e. principal wasn't already zero going in).
  const currentInst = isSettled
    ? undefined
    : sortedInstallments.find((i) => {
        const owed = perInstallmentInterestOwed[i.id];
        const paid = perInstallmentPaid[i.id] ?? new Decimal(0);
        return owed.gt(0) && paid.lt(owed);
      });
  const currentCycle = currentInst?.cycleNumber ?? null;

  const interestOwedThisCycle = currentInst
    ? perInstallmentInterestOwed[currentInst.id]
    : new Decimal(0);
  const interestPaidThisCycle = currentInst
    ? Decimal.min(
        interestOwedThisCycle,
        perInstallmentPaid[currentInst.id] ?? new Decimal(0),
      )
    : new Decimal(0);
  const interestOnlyNow = isSettled
    ? new Decimal(0)
    : round2(subtract(interestOwedThisCycle, interestPaidThisCycle));
  const settlementAmountNow = isSettled
    ? new Decimal(0)
    : round2(add(principalOutstanding, interestOnlyNow));

  return {
    principal,
    ratePct,
    totalCollected,
    interestCollected: round2(interestCollected),
    principalCollected: round2(principalCollected),
    principalOutstanding,
    settlementAmountNow,
    interestOnlyNow,
    currentCycle,
    isSettled,
    perInstallmentPaid,
    perInstallmentInterestOwed,
    perInstallmentOpeningPrincipal,
  };
}
