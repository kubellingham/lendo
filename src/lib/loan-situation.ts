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
  /** Final (or extra) round: the whole balance must be paid. */
  isFinalRound: boolean;
  /** Due date of the current round. */
  dueDate: Date | null;
  /** Calendar days until the due date (0 = today, negative = overdue). */
  daysUntilDue: number | null;
  /** Least they must pay by the due date (round interest, or everything on the final round). */
  minimumDue: Decimal;
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
  return {
    settled,
    round,
    roundsAgreed: loan.cyclesAllowed,
    isFinalRound,
    dueDate: inst?.dueDate ?? null,
    daysUntilDue: inst ? calendarDays(now, inst.dueDate) : null,
    minimumDue: isFinalRound ? toClear : interestDue,
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

/** Bullet lines for what to pay, matching the round (used in messages and PDFs). */
export function amountLines(s: LoanSituation): string {
  if (s.settled) return "• Balance: TSh 0 — fully repaid";
  if (s.isFinalRound) {
    return `• Amount to pay: *${tsh(s.toClear)}* (final round — the full balance must be paid)`;
  }
  return [
    `• Minimum to pay: *${tsh(s.minimumDue)}* (interest for round ${s.round} of ${s.roundsAgreed})`,
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
  const what = s.isFinalRound
    ? `${tsh(s.toClear)} must be paid in full (final round)`
    : `at least ${tsh(s.minimumDue)} (round ${s.round} interest)`;
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
