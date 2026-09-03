import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { formatDate, nowInTz } from "@/lib/dates";

export type ReferralLoanLine = {
  loanRef: string;
  principal: Decimal;
  amountDue: Decimal;
  dueDate: Date;
  daysOverdue: number;
};

export type ReferralOverdue = {
  borrowerName: string;
  referralName: string | null;
  referralPhone: string | null;
  loans: ReferralLoanLine[];
  total: Decimal;
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

  const now = nowInTz();
  const loans: ReferralLoanLine[] = [];
  let total = money(0);

  for (const loan of customer.loans) {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments,
    });
    const { loanStatus } = deriveStatuses(
      {
        principal: loan.principal,
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        cyclesAllowed: loan.cyclesAllowed,
        installments: loan.installments,
        payments: [],
      },
      state,
      state.currentCycle ?? loan.cyclesAllowed,
      loan.dueAt,
      now,
    );
    if (loanStatus !== "OVERDUE" && loanStatus !== "DEFAULTED") continue;

    const daysOverdue = Math.max(
      0,
      Math.floor((now.getTime() - loan.dueAt.getTime()) / DAY),
    );
    loans.push({
      loanRef: loanRef(loan.id),
      principal: money(loan.principal),
      amountDue: state.settlementAmountNow,
      dueDate: loan.dueAt,
      daysOverdue,
    });
    total = total.plus(state.settlementAmountNow);
  }

  return {
    borrowerName: customer.fullName,
    referralName: customer.referralName,
    referralPhone: customer.referralPhone,
    loans,
    total: round2(total),
  };
}

/** The consolidated WhatsApp message to the referral (handles 1 or many loans). */
export function buildReferralMessage(d: ReferralOverdue): string {
  const count = d.loans.length;
  const lines = d.loans
    .map((l, i) => {
      const overdue =
        l.daysOverdue > 0 ? `, ${l.daysOverdue} day(s) overdue` : "";
      return `${i + 1}. ${l.loanRef} — TSh ${num(l.amountDue)} (due ${formatDate(
        l.dueDate,
      )}${overdue})`;
    })
    .join("\n");

  const single = count === 1;
  const intro = single
    ? `has an outstanding loan with Lendo`
    : `has ${count} outstanding loans with Lendo`;

  return `Dear ${d.referralName || "referrer"},

Your referral, *${d.borrowerName}*, ${intro}, totalling *TSh ${num(d.total)}* still to be paid:

${lines}

Please kindly remind them to clear the outstanding amount as soon as possible. If they are unable to pay immediately, please have them share when the payment will be made.

Thank you for your cooperation and continued support.

Regards,
The Lendo Team
_Helping you move forward._`;
}
