import Decimal from "decimal.js";
import { add, money, round2, subtract } from "@/lib/money";
import type { InstallmentStatus, LoanStatus } from "@/generated/prisma/enums";

// Allocation model (v1):
//   Each cycle charges interest I = 0.15 * P. When money is applied to a cycle
//   it covers that cycle's interest first; any surplus pays down principal
//   (a single global pool, capped at P). The loan is settled once principal is
//   fully paid. This is consistent and exact: collected == interest + principal.

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
  installments: CalcInstallment[];
  payments: CalcPayment[];
}

export interface LoanState {
  principal: Decimal;
  perCycleInterest: Decimal;
  totalCollected: Decimal;
  interestCollected: Decimal;
  principalCollected: Decimal;
  principalOutstanding: Decimal;
  /** Amount required to fully settle the loan right now. */
  settlementAmountNow: Decimal;
  /** Interest-only amount to roll the current cycle. */
  interestOnlyNow: Decimal;
  /** Cycle number currently due (earliest unsettled), or null if settled. */
  currentCycle: number | null;
  isSettled: boolean;
  perInstallmentPaid: Record<string, Decimal>;
}

export function computeLoanState(loan: LoanStateInput): LoanState {
  const principal = round2(loan.principal);
  const perCycleInterest =
    loan.installments.length > 0
      ? round2(loan.installments[0].expectedInterest)
      : round2(principal.times(0.15));

  const perInstallmentPaid: Record<string, Decimal> = {};
  for (const inst of loan.installments) perInstallmentPaid[inst.id] = new Decimal(0);

  let totalCollected = new Decimal(0);
  for (const p of loan.payments) {
    const amt = money(p.amount);
    totalCollected = totalCollected.plus(amt);
    if (p.installmentId && perInstallmentPaid[p.installmentId] !== undefined) {
      perInstallmentPaid[p.installmentId] =
        perInstallmentPaid[p.installmentId].plus(amt);
    }
  }
  totalCollected = round2(totalCollected);

  // Surplus over each cycle's interest pays principal.
  let principalSurplus = new Decimal(0);
  for (const inst of loan.installments) {
    const paid = perInstallmentPaid[inst.id] ?? new Decimal(0);
    const surplus = paid.minus(perCycleInterest);
    if (surplus.gt(0)) principalSurplus = principalSurplus.plus(surplus);
  }
  // Payments not tied to an installment still reduce principal after interest.
  const unallocated = loan.payments
    .filter((p) => !p.installmentId)
    .reduce<Decimal>((acc, p) => acc.plus(money(p.amount)), new Decimal(0));
  principalSurplus = principalSurplus.plus(unallocated);

  const principalCollected = Decimal.min(principal, Decimal.max(0, principalSurplus));
  const interestCollected = round2(totalCollected.minus(principalCollected));
  const principalOutstanding = round2(subtract(principal, principalCollected));

  const isSettled =
    loan.status === "SETTLED" || principalOutstanding.lte(0);

  // Current cycle = earliest installment still awaiting interest (i.e. not yet
  // rolled via INTEREST_PAID and not SETTLED).
  const currentInst = loan.installments
    .slice()
    .sort((a, b) => a.cycleNumber - b.cycleNumber)
    .find((i) => i.status !== "SETTLED" && i.status !== "INTEREST_PAID");
  const currentCycle = isSettled ? null : (currentInst?.cycleNumber ?? null);

  const interestPaidThisCycle = currentInst
    ? Decimal.min(perCycleInterest, perInstallmentPaid[currentInst.id] ?? new Decimal(0))
    : perCycleInterest;
  const interestOnlyNow = isSettled
    ? new Decimal(0)
    : round2(subtract(perCycleInterest, interestPaidThisCycle));
  const settlementAmountNow = isSettled
    ? new Decimal(0)
    : round2(add(principalOutstanding, interestOnlyNow));

  return {
    principal,
    perCycleInterest,
    totalCollected,
    interestCollected,
    principalCollected: round2(principalCollected),
    principalOutstanding,
    settlementAmountNow,
    interestOnlyNow,
    currentCycle,
    isSettled,
    perInstallmentPaid,
  };
}
