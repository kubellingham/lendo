import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState, type LoanStateInput } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { formatDate, toBusinessDate } from "@/lib/dates";
import { loanSituation, roundsText } from "@/lib/loan-situation";

export type ReferralLoanLine = {
  loanId: string;
  loanRef: string;
  principal: Decimal;
  /** What is overdue now: the round's interest, or everything on the final round. */
  amountDue: Decimal;
  /** Paying this clears the loan. */
  toClear: Decimal;
  round: number | null;
  isFinalRound: boolean;
  /** Rounds past due with interest unpaid. */
  overdueRounds: number[];
  dueDate: Date;
  daysOverdue: number;
};

export type ReferralOverdue = {
  borrowerName: string;
  referralName: string | null;
  referralPhone: string | null;
  loans: ReferralLoanLine[];
  /** Total overdue now (sum of amountDue). */
  total: Decimal;
  /** Total to clear every overdue loan. */
  totalToClear: Decimal;
};

const DAY = 24 * 60 * 60 * 1000;

function loanRef(id: string): string {
  return "LND-" + id.slice(-6).toUpperCase();
}

/** Plain number, e.g. "1,150,000" (the "TSh" prefix is added in the copy). */
export function num(value: Decimal | string | number): string {
  return new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(
    money(value).toNumber(),
  );
}

/**
 * Gather every overdue/defaulted loan for a borrower and the total still owed,
 * along with the referral (referee) to notify. Uses the effective status so a
 * loan that has rolled its final cycle is included even before the stored
 * status catches up.
 */
export async function getReferralOverdue(
  customerId: string,
): Promise<ReferralOverdue | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      loans: {
        where: { status: { notIn: ["SETTLED", "WRITTEN_OFF"] } },
        include: {
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: { select: { amount: true, installmentId: true } },
        },
      },
    },
  });
  if (!customer) return null;

  // Same calculation as every other message: a loan is overdue when its
  // current round's due date (Tanzania calendar days) has passed.
  const loans: ReferralLoanLine[] = [];
  for (const loan of customer.loans) {
    const sit = loanSituation(loan);
    if (sit.settled || sit.dueDate == null || sit.daysUntilDue == null || sit.daysUntilDue >= 0) continue;
    loans.push({
      loanId: loan.id,
      loanRef: loanRef(loan.id),
      principal: money(loan.principal),
      amountDue: round2(sit.minimumDue),
      toClear: round2(sit.toClear),
      round: sit.round,
      isFinalRound: sit.fullBalanceDue,
      overdueRounds: sit.overdueRounds,
      dueDate: sit.dueDate,
      daysOverdue: -sit.daysUntilDue,
    });
  }

  return {
    borrowerName: customer.fullName,
    referralName: customer.referralName,
    referralPhone: customer.referralPhone,
    loans,
    total: round2(loans.reduce((t, l) => t.plus(l.amountDue), money(0))),
    totalToClear: round2(loans.reduce((t, l) => t.plus(l.toClear), money(0))),
  };
}

/** The consolidated WhatsApp message to the referral (handles 1 or many loans). */
export function buildReferralMessage(
  d: ReferralOverdue,
  pay?: { bank: string; accountName: string; accountNumber: string },
): string {
  const single = d.loans.length === 1;
  const lines = d.loans
    .map((l, i) => {
      const head = `${single ? "" : `${i + 1}. `}*${l.loanRef}* — was due ${formatDate(l.dueDate)}, *${l.daysOverdue} day(s) overdue*`;
      const detail = l.isFinalRound
        ? `   • Overdue: TSh ${num(l.amountDue)} (final round — the full balance)`
        : `   • Overdue: TSh ${num(l.amountDue)} (interest for ${roundsText(l.overdueRounds.length ? l.overdueRounds : [l.round ?? 1])})\n   • To clear the loan: TSh ${num(l.toClear)}`;
      return `${head}\n${detail}`;
    })
    .join("\n\n");

  const intro = single
    ? "has a Lendo loan payment that is overdue"
    : `has ${d.loans.length} Lendo loan payments that are overdue`;
  const totals = single
    ? ""
    : `\n\n*Overdue now: TSh ${num(d.total)}*\nTo clear all these loans: TSh ${num(d.totalToClear)}`;
  const payBlock = pay
    ? `\n\n*How they can pay*\n• Bank: ${pay.bank}\n• Account name: ${pay.accountName}\n• Account number: ${pay.accountNumber}`
    : "";

  return `Dear ${d.referralName || "referrer"},

Your referral, *${d.borrowerName}*, ${intro}:

${lines}${totals}${payBlock}

Please kindly remind them to pay as soon as possible. If they are unable to pay immediately, please have them share when the payment will be made.

Thank you for your cooperation and continued support.

Regards,
The Lendo Team
_Helping you move forward._`;
}

// ---------------------------------------------------------------------------
// Upcoming payments — a friendly heads-up to the referral *before* the
// borrower's next payment falls due (the counterpart to the overdue notice).
// ---------------------------------------------------------------------------

export type UpcomingLine = {
  loanId: string;
  loanRef: string;
  dueDate: Date;
  daysUntilDue: number;
  cycleNumber: number;
  isFinalCycle: boolean;
  /** Least they can pay by the due date (interest only, or full settlement on the final cycle). */
  minimumDue: Decimal;
  /** Paying this clears the loan completely. */
  settleAmount: Decimal;
};

export type ReferralUpcoming = {
  borrowerName: string;
  referralName: string | null;
  referralPhone: string | null;
  loans: UpcomingLine[];
  totalMinimum: Decimal;
  totalToSettle: Decimal;
};

type UpcomingLoanInput = LoanStateInput & {
  id: string;
  cyclesAllowed: number;
};

/**
 * The next payment on a loan, if it is still upcoming (due today or later).
 * Returns null for settled loans or loans whose current cycle is already past
 * due — those belong in the overdue notice instead.
 */
export function upcomingForLoan(
  loan: UpcomingLoanInput,
  today: Date = toBusinessDate(new Date()),
): UpcomingLine | null {
  if (loan.status === "SETTLED" || loan.status === "WRITTEN_OFF") return null;
  const state = computeLoanState(loan);
  if (state.isSettled || state.currentCycle == null) return null;

  const inst = loan.installments.find(
    (i) => i.cycleNumber === state.currentCycle,
  );
  if (!inst) return null;

  const daysUntilDue = Math.round(
    (toBusinessDate(inst.dueDate).getTime() - today.getTime()) / DAY,
  );
  if (daysUntilDue < 0) return null;

  const isFinalCycle = inst.cycleNumber >= loan.cyclesAllowed;
  return {
    loanId: loan.id,
    loanRef: loanRef(loan.id),
    dueDate: inst.dueDate,
    daysUntilDue,
    cycleNumber: inst.cycleNumber,
    isFinalCycle,
    minimumDue: isFinalCycle ? state.settlementAmountNow : state.interestOnlyNow,
    settleAmount: state.settlementAmountNow,
  };
}

/** Every upcoming (not yet overdue) payment for a borrower, for their referral. */
export async function getReferralUpcoming(
  customerId: string,
): Promise<ReferralUpcoming | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      loans: {
        where: { status: { notIn: ["SETTLED", "WRITTEN_OFF"] } },
        include: {
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: { select: { amount: true, installmentId: true } },
        },
      },
    },
  });
  if (!customer) return null;

  const today = toBusinessDate(new Date());
  const loans = customer.loans
    .map((l) => upcomingForLoan(l, today))
    .filter((l): l is UpcomingLine => l !== null)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return {
    borrowerName: customer.fullName,
    referralName: customer.referralName,
    referralPhone: customer.referralPhone,
    loans,
    totalMinimum: round2(
      loans.reduce((s, l) => s.plus(l.minimumDue), money(0)),
    ),
    totalToSettle: round2(
      loans.reduce((s, l) => s.plus(l.settleAmount), money(0)),
    ),
  };
}

/** "today" / "tomorrow" / "in 5 days" */
export function dueWhen(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** WhatsApp heads-up to the referral about upcoming payment(s). */
export function buildReferralUpcomingMessage(
  d: Pick<ReferralUpcoming, "borrowerName" | "referralName" | "loans" | "totalMinimum" | "totalToSettle">,
  pay?: { bank: string; accountName: string; accountNumber: string },
): string {
  const count = d.loans.length;
  const single = count === 1;

  const lines = d.loans
    .map((l, i) => {
      const head = `${single ? "" : `${i + 1}. `}*${l.loanRef}* — due ${formatDate(l.dueDate)} (${dueWhen(l.daysUntilDue)})`;
      const detail = l.isFinalCycle
        ? `   • Amount due (final cycle — full settlement): TSh ${num(l.settleAmount)}`
        : `   • Minimum due (interest for cycle ${l.cycleNumber}): TSh ${num(l.minimumDue)}\n   • To clear the loan in full: TSh ${num(l.settleAmount)}`;
      return `${head}\n${detail}`;
    })
    .join("\n\n");

  const intro = single
    ? `has a Lendo loan payment coming up ${dueWhen(d.loans[0].daysUntilDue)}`
    : `has ${count} Lendo loan payments coming up`;

  const totals = single
    ? ""
    : `\n\n*Minimum due across all loans: TSh ${num(d.totalMinimum)}*\nTo clear everything: TSh ${num(d.totalToSettle)}`;

  const payBlock = pay
    ? `\n\n*How they can pay*\n• Bank: ${pay.bank}\n• Account name: ${pay.accountName}\n• Account number: ${pay.accountNumber}`
    : "";

  return `Dear ${d.referralName || "referrer"},

A friendly heads-up — your referral, *${d.borrowerName}*, ${intro}:

${lines}${totals}${payBlock}

We'd appreciate it if you could gently remind them so the payment is made on time. If it has already been paid, please disregard this message.

Thank you for your continued support.

Regards,
The Lendo Team
_Borrow with confidence. Repay with ease._`;
}

// ---------------------------------------------------------------------------
// Choosing which loans go into a referral message. `ids` undefined = all.
// Totals are recomputed so the message only counts what was chosen.
// ---------------------------------------------------------------------------

export function pickOverdue(
  d: ReferralOverdue,
  ids?: string[],
): ReferralOverdue {
  if (!ids) return d;
  const keep = new Set(ids);
  const loans = d.loans.filter((l) => keep.has(l.loanId));
  return {
    ...d,
    loans,
    total: round2(loans.reduce((s, l) => s.plus(l.amountDue), money(0))),
    totalToClear: round2(loans.reduce((s, l) => s.plus(l.toClear), money(0))),
  };
}

export function pickUpcoming(
  d: ReferralUpcoming,
  ids?: string[],
): ReferralUpcoming {
  if (!ids) return d;
  const keep = new Set(ids);
  const loans = d.loans.filter((l) => keep.has(l.loanId));
  return {
    ...d,
    loans,
    totalMinimum: round2(loans.reduce((s, l) => s.plus(l.minimumDue), money(0))),
    totalToSettle: round2(
      loans.reduce((s, l) => s.plus(l.settleAmount), money(0)),
    ),
  };
}

/** Parse a "id1,id2" list from a query string / form value. */
export function parseLoanIds(raw: string | null | undefined): string[] | undefined {
  if (raw == null) return undefined;
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}
