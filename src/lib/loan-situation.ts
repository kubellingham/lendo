import Decimal from "decimal.js";
import { computeLoanState, type LoanStateInput } from "@/lib/loan-calc";
import { formatDate, toBusinessDate } from "@/lib/dates";

// ---------------------------------------------------------------------------
// One source of truth for "where is this loan right now": which round the
// borrower is in, when it's due (in Tanzania calendar days), and how much they
// must pay. Messages, notice PDFs, referral notices and Lendo AI all use this,
// so they can never disagree with each other.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

export type LoanSituation = {
  settled: boolean;
  /** Round the borrower is in now (null when settled). */
  round: number | null;
  roundsAgreed: number;
  /** The current round is the final (or an extra) round. */
  isFinalRound: boolean;
  /** The whole balance must be paid now: final round, or the final round has already passed. */
  fullBalanceDue: boolean;
  /** Due date of the current round. */
  dueDate: Date | null;
  /** Calendar days until the due date (0 = today, negative = overdue). */
  daysUntilDue: number | null;
  /**
   * Least they must pay now / by the due date: the round's interest (or
   * everything on the final round). When rounds are already past due, it is
   * ALL of their unpaid interest — not just the first missed round's.
   */
  minimumDue: Decimal;
  /** Rounds whose due date has passed with interest still unpaid (e.g. [1, 2]). */
  overdueRounds: number[];
  /** What is overdue right now (0 if nothing is late). */
  amountOverdue: Decimal;
  /** Interest still owed for the current round. */
  interestDue: Decimal;
  /** Paying this clears the loan today. */
  toClear: Decimal;
  principalOutstanding: Decimal;
  totalPaid: Decimal;
  finalDueDate: Date;
};

export type SituationLoan = LoanStateInput & {
  cyclesAllowed: number;
  dueAt: Date;
};

/** Whole calendar days from `from` to `to` (Tanzania dates). */
export function calendarDays(from: Date, to: Date): number {
  return Math.round((toBusinessDate(to).getTime() - toBusinessDate(from).getTime()) / DAY);
}

export function loanSituation(loan: SituationLoan, now: Date = new Date()): LoanSituation {
  const state = computeLoanState(loan);
  const settled = state.isSettled || loan.status === "SETTLED" || loan.status === "WRITTEN_OFF";
  const inst = settled
    ? undefined
    : loan.installments.find((i) => i.cycleNumber === state.currentCycle);
  const round = inst?.cycleNumber ?? null;
  const isFinalRound = round != null && round >= loan.cyclesAllowed;
  const interestDue = settled ? new Decimal(0) : state.interestOnlyNow;
  const toClear = settled ? new Decimal(0) : state.settlementAmountNow;

  // Every round already past due (calendar days, Tanzania) with interest unpaid.
  const overdueRounds: number[] = [];
  let amountOverdue = new Decimal(0);
  let finalPastDue = false;
  if (!settled) {
    for (const i of loan.installments) {
      if (calendarDays(now, i.dueDate) >= 0) continue;
      const owed = state.perInstallmentInterestOwed[i.id] ?? new Decimal(0);
      const unpaid = Decimal.max(0, owed.minus(state.perInstallmentPaid[i.id] ?? 0));
      if (unpaid.lte(0.5) && i.cycleNumber < loan.cyclesAllowed) continue;
      if (i.cycleNumber >= loan.cyclesAllowed) finalPastDue = true;
      if (unpaid.gt(0.5)) overdueRounds.push(i.cycleNumber);
      amountOverdue = amountOverdue.plus(unpaid);
    }
    // Once the final round has passed, the whole balance is overdue.
    if (finalPastDue) amountOverdue = toClear;
  }
  const minimumDue = amountOverdue.gt(0) ? amountOverdue : isFinalRound ? toClear : interestDue;
  return {
    settled,
    round,
    roundsAgreed: loan.cyclesAllowed,
    isFinalRound,
    fullBalanceDue: !settled && (isFinalRound || finalPastDue),
    dueDate: inst?.dueDate ?? null,
    daysUntilDue: inst ? calendarDays(now, inst.dueDate) : null,
    minimumDue,
    overdueRounds,
    amountOverdue,
    interestDue,
    toClear,
    principalOutstanding: state.principalOutstanding,
    totalPaid: state.totalCollected,
    finalDueDate: loan.dueAt,
  };
}

/** "today" / "tomorrow" / "in 5 days" / "yesterday" / "3 days ago" */
export function dueWhenText(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${-days} days ago`;
}

function tsh(n: Decimal | number): string {
  return `TSh ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(Number(n)))}`;
}

/** "round 2" / "rounds 1–2" / "rounds 1, 2 and 4" */
export function roundsText(rounds: number[]): string {
  if (rounds.length <= 1) return `round ${rounds[0] ?? ""}`.trim();
  const consecutive = rounds.every((r, i) => i === 0 || r === rounds[i - 1] + 1);
  return consecutive
    ? `rounds ${rounds[0]}–${rounds[rounds.length - 1]}`
    : `rounds ${rounds.slice(0, -1).join(", ")} and ${rounds[rounds.length - 1]}`;
}

/** Why the minimum is what it is: "interest for round 2 of 3" / "unpaid interest for rounds 1–2 of 3". */
export function minimumReason(s: LoanSituation): string {
  if (s.overdueRounds.length > 1) return `unpaid interest for ${roundsText(s.overdueRounds)} of ${s.roundsAgreed}`;
  return `interest for round ${s.round} of ${s.roundsAgreed}`;
}

/** Bullet lines for what to pay, matching the round (used in messages and PDFs). */
export function amountLines(s: LoanSituation): string {
  if (s.settled) return "• Balance: TSh 0 — fully repaid";
  if (s.fullBalanceDue) {
    return `• Amount to pay: *${tsh(s.toClear)}* (final round — the full balance must be paid)`;
  }
  return [
    `• Minimum to pay: *${tsh(s.minimumDue)}* (${minimumReason(s)})`,
    `• To clear the whole loan: ${tsh(s.toClear)}`,
  ].join("\n");
}

/** One plain sentence describing the situation (for staff, not customers). */
export function situationSummary(s: LoanSituation): string {
  if (s.settled) return "This loan is fully repaid.";
  if (s.dueDate == null || s.daysUntilDue == null) return "No payment is scheduled.";
  const d = s.daysUntilDue;
  const when =
    d < 0 ? `${-d} day(s) overdue (was due ${formatDate(s.dueDate)})` : `due ${dueWhenText(d)}, ${formatDate(s.dueDate)}`;
  const what = s.fullBalanceDue
    ? `${tsh(s.toClear)} must be paid in full (final round)`
    : `at least ${tsh(s.minimumDue)} (${minimumReason(s)})`;
  return `Round ${s.round} of ${s.roundsAgreed}: ${when} — ${what}.`;
}

/** The template that fits the situation best. */
export function bestTemplateFor(s: LoanSituation): string {
  if (s.settled) return "loan_settled";
  const d = s.daysUntilDue ?? 99;
  if (d < 0) return "overdue";
  if (d === 0) return "due_today";
  if (d <= 4) return "reminder_3d";
  return "reminder_7d";
}

/** A warning when the chosen template doesn't fit the loan right now (null if fine). */
export function templateMismatch(templateKey: string, s: LoanSituation): string | null {
  const d = s.daysUntilDue;
  const reminder = templateKey === "reminder_7d" || templateKey === "reminder_3d";
  const timed = reminder || templateKey === "due_today" || templateKey === "overdue" || templateKey === "referral_overdue";
  if (!timed) return null;
  if (s.settled) return "This loan is fully repaid — there's nothing to remind them about.";
  if (d == null) return null;
  if (reminder && d < 0) return `This payment is already ${-d} day(s) overdue — use the overdue notice instead.`;
  if (reminder && d === 0) return "This payment is due today — use the “Due today” message instead.";
  if (templateKey === "due_today" && d !== 0)
    return d > 0
      ? `This payment is due ${dueWhenText(d)}, not today — use a payment reminder instead.`
      : `This payment was due ${-d} day(s) ago — use the overdue notice instead.`;
  if ((templateKey === "overdue" || templateKey === "referral_overdue") && d >= 0)
    return `This payment isn't overdue yet — it's due ${dueWhenText(d)}.`;
  return null;
}
