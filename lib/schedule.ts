import Decimal from 'decimal.js';
import { addDaysUTC } from './dates';
import { money } from './money';

export type ScheduleInput = {
  principal: Decimal.Value;
  interestRatePct?: Decimal.Value; // default 15
  cyclesAllowed?: number;          // default 3
  cycleDays?: number;              // default 30
  disbursedAt: Date;
};

export type ScheduledInstallment = {
  cycleNumber: number;
  dueDate: Date;
  expectedInterest: Decimal;
  /**
   * Principal expected at this cycle if the customer chooses to settle here.
   * The customer can either pay interest-only and roll, OR pay
   * principal + interest to settle. The final cycle is mandatory settlement.
   */
  expectedPrincipalAtThisCycle: Decimal;
  mandatorySettlement: boolean;
};

/**
 * Generates the loan repayment schedule.
 *
 * Rule (Lendo v1, Tanzania): 15% of principal per 30-day cycle, simple interest,
 * up to 3 cycles. Customer pays either interest-only (roll forward) or full
 * settlement at any cycle. Cycle 3 is mandatory settlement.
 */
export function generateSchedule(input: ScheduleInput): ScheduledInstallment[] {
  const principal = money(input.principal);
  const ratePct = money(input.interestRatePct ?? 15);
  const cycles = input.cyclesAllowed ?? 3;
  const cycleDays = input.cycleDays ?? 30;

  const interestPerCycle = principal.times(ratePct).div(100);

  const schedule: ScheduledInstallment[] = [];
  for (let i = 1; i <= cycles; i++) {
    schedule.push({
      cycleNumber: i,
      dueDate: addDaysUTC(input.disbursedAt, cycleDays * i),
      expectedInterest: interestPerCycle,
      expectedPrincipalAtThisCycle: principal,
      mandatorySettlement: i === cycles,
    });
  }
  return schedule;
}

export function loanDueDate(input: ScheduleInput): Date {
  const cycles = input.cyclesAllowed ?? 3;
  const cycleDays = input.cycleDays ?? 30;
  return addDaysUTC(input.disbursedAt, cycleDays * cycles);
}
