import Decimal from "decimal.js";
import { addBusinessDays, toBusinessDate } from "@/lib/dates";
import { percentOf, round2 } from "@/lib/money";
import type { MoneyInput } from "@/lib/money";

// Loan rules (v1):
//   - Term: up to 90 days, split into three 30-day cycles.
//   - Interest: 15% of principal per cycle (simple, not compounding).
//   - Each cycle the borrower may either:
//       * fully settle: principal + this cycle's interest (P + 0.15P), or
//       * pay interest only (0.15P) and roll to the next cycle.
//   - At the final cycle (day 90) full settlement is mandatory.
//
// The schedule generator is pure: given principal + disbursal date it returns
// the three cycles with due dates and expected amounts. It does no I/O so it is
// directly unit-testable.

export interface ScheduleParams {
  principal: MoneyInput;
  disbursedAt: Date;
  interestRatePct?: number; // default 15
  cycleDays?: number; // default 30
  cyclesAllowed?: number; // default 3
}

export interface ScheduledInstallment {
  cycleNumber: number;
  dueDate: Date;
  /** Interest expected for this cycle (always 0.15 * principal). */
  expectedInterest: Decimal;
  /**
   * Principal scheduled to fall due at this cycle. Only the final (mandatory
   * settlement) cycle carries the principal in the planned schedule; earlier
   * cycles are interest-only rollovers, so this is 0 for them.
   */
  expectedPrincipalAtThisCycle: Decimal;
  /** Amount to pay to roll over (interest only) at this cycle. */
  interestOnlyAmount: Decimal;
  /** Amount to pay to fully settle the loan at this cycle (P + 0.15P). */
  fullSettlementAmount: Decimal;
  /** True for the last cycle, where settlement is mandatory. */
  isMandatorySettlement: boolean;
}

export interface GeneratedSchedule {
  disbursedAt: Date;
  dueAt: Date;
  /** Interest charged per cycle (0.15 * P). */
  perCycleInterest: Decimal;
  /** Worst-case total interest over all cycles (e.g. 0.45 * P). */
  maxTotalInterest: Decimal;
  /** Worst-case total repayment (e.g. 1.45 * P). */
  maxTotalRepayment: Decimal;
  installments: ScheduledInstallment[];
}

export function generateSchedule(params: ScheduleParams): GeneratedSchedule {
  const {
    principal,
    disbursedAt,
    interestRatePct = 15,
    cycleDays = 30,
    cyclesAllowed = 3,
  } = params;

  const p = round2(principal);
  const start = toBusinessDate(disbursedAt);
  const perCycleInterest = round2(percentOf(p, interestRatePct));

  const installments: ScheduledInstallment[] = [];
  for (let cycle = 1; cycle <= cyclesAllowed; cycle++) {
    const isLast = cycle === cyclesAllowed;
    const dueDate = addBusinessDays(start, cycleDays * cycle);
    const principalThisCycle = isLast ? p : new Decimal(0);

    installments.push({
      cycleNumber: cycle,
      dueDate,
      expectedInterest: perCycleInterest,
      expectedPrincipalAtThisCycle: round2(principalThisCycle),
      interestOnlyAmount: perCycleInterest,
      fullSettlementAmount: round2(p.plus(perCycleInterest)),
      isMandatorySettlement: isLast,
    });
  }

  const dueAt = addBusinessDays(start, cycleDays * cyclesAllowed);
  const maxTotalInterest = round2(perCycleInterest.times(cyclesAllowed));
  const maxTotalRepayment = round2(p.plus(maxTotalInterest));

  return {
    disbursedAt: start,
    dueAt,
    perCycleInterest,
    maxTotalInterest,
    maxTotalRepayment,
    installments,
  };
}
