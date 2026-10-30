"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { computeLoanState } from "@/lib/loan-calc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getTemplate, renderMessage } from "@/lib/message-templates";
import {
  getReferralOverdue,
  buildReferralMessage,
  getReferralUpcoming,
  upcomingForLoan,
  buildReferralUpcomingMessage,
  pickOverdue,
  pickUpcoming,
  parseLoanIds,
  dueWhen,
} from "@/lib/referral";
import { getPaymentDetails } from "@/lib/settings";

/** One loan the staff member can switch on/off in a referral message. */
export type ReferralPick = {
  loanId: string;
  loanRef: string;
  dueDate: string;
  /** Days until due (upcoming) or days overdue (overdue). */
  days: number;
  /** e.g. "in 5 days" / "12 days overdue" */
  when: string;
  amount: string;
};

export type MessagePreview = {
  ok: true;
  message: string;
  customerName: string;
  phoneE164: string;
  loanRef: string | null;
  /** Every loan that could go into a referral message (for the on/off list). */
  referralLoans?: ReferralPick[];
};

export type MessageError = { ok: false; error: string };

// Short human-friendly loan reference derived from the loan id.
function loanRef(loanId: string): string {
  return "LND-" + loanId.slice(-6).toUpperCase();
}

function tsh(n: unknown): string {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(
    Number.isFinite(num) ? Math.round(num) : 0,
  );
}

/**
 * Render a loan-context template (reminders, disbursed, approved, settled)
 * for a specific loan, using real balances, dates, and cycle numbers.
 */
export async function previewLoanMessage(
  loanId: string,
  templateKey: string,
): Promise<MessagePreview | MessageError> {
  try {
    const _u = await requireUser();
    if (_u.role === "DEMO_VIEWER") return { ok: false, error: "Not available in demo mode." };
    const template = getTemplate(templateKey);
    if (!template) return { ok: false, error: "Unknown template." };

    const loan = await db.loan.findUnique({
      where: { id: loanId },
      include: {
        customer: {
          select: {
            fullName: true,
            phone: true,
            referralName: true,
            referralPhone: true,
          },
        },
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: {
          select: { amount: true, installmentId: true, paidAt: true },
          orderBy: { paidAt: "desc" },
        },
      },
    });
    if (!loan) return { ok: false, error: "Loan not found." };

    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments,
    });

    // Upcoming-payment heads-up to the referral (built in code, not a template).
    if (templateKey === "referral_upcoming") {
      if (!loan.customer.referralPhone) {
        return {
          ok: false,
          error:
            "No referral is on file for this customer. Add a referral (name + phone) on the customer profile first.",
        };
      }
      const line = upcomingForLoan(loan);
      if (!line) {
        return {
          ok: false,
          error:
            "This loan has no upcoming payment — it is either settled or already past due. Use the referral overdue notice instead.",
        };
      }
      const pay = await getPaymentDetails();
      return {
        ok: true,
        message: buildReferralUpcomingMessage(
          {
            borrowerName: loan.customer.fullName,
            referralName: loan.customer.referralName,
            loans: [line],
            totalMinimum: line.minimumDue,
            totalToSettle: line.settleAmount,
          },
          pay,
        ),
        customerName: loan.customer.referralName || "Referral",
        phoneE164: loan.customer.referralPhone,
        loanRef: line.loanRef,
      };
    }

    const currentInst = loan.installments.find(
      (i) => i.status !== "SETTLED" && i.status !== "INTEREST_PAID",
    );
    const dueDateSource =
      currentInst?.dueDate ?? loan.dueAt ?? loan.installments[0].dueDate;

    const nowMs = Date.now();
    const daysOverdue = Math.max(
      0,
      Math.floor((nowMs - dueDateSource.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const interestForCurrent = currentInst
      ? state.perInstallmentInterestOwed[currentInst.id]
      : state.interestOnlyNow;

    const lastPayment = loan.payments[0];
    const totalRepaid = state.totalCollected;

    // Referral notices go to the referee, not the borrower — so they need a
    // referral on file.
    const isReferral = template.category === "referral";
    if (isReferral && !loan.customer.referralPhone) {
      return {
        ok: false,
        error:
          "No referral is on file for this customer. Add a referral (name + phone) on the customer profile first.",
      };
    }

    const pay = await getPaymentDetails();
    const message = renderMessage(template.body, {
      customerName: loan.customer.fullName,
      referralName: loan.customer.referralName || "referrer",
      loanRef: loanRef(loan.id),
      principal: tsh(loan.principal),
      interest: tsh(interestForCurrent),
      interestRate: `${loan.interestRatePct}%`,
      outstanding: tsh(state.principalOutstanding),
      totalDue: tsh(state.settlementAmountNow),
      dueDate: formatDate(dueDateSource),
      disbursedDate: formatDate(loan.disbursedAt),
      daysOverdue,
      totalRepaid: tsh(totalRepaid),
      paidAt: lastPayment ? formatDateTime(lastPayment.paidAt) : "—",
      paymentBank: pay.bank,
      paymentAccountName: pay.accountName,
      paymentAccountNumber: pay.accountNumber,
    });

    return {
      ok: true,
      message,
      customerName: isReferral
        ? loan.customer.referralName || "Referral"
        : loan.customer.fullName,
      phoneE164: isReferral
        ? loan.customer.referralPhone ?? ""
        : loan.customer.phone,
      loanRef: loanRef(loan.id),
    };
  } catch (err) {
    console.error("[previewLoanMessage]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not build message: ${err.message}`
          : "Could not build message.",
    };
  }
}

/**
 * Render a payment-context receipt for a specific payment row.
 */
export async function previewPaymentMessage(
  paymentId: string,
  templateKey = "payment_received",
): Promise<MessagePreview | MessageError> {
  try {
    const _u = await requireUser();
    if (_u.role === "DEMO_VIEWER") return { ok: false, error: "Not available in demo mode." };
    const template = getTemplate(templateKey);
    if (!template) return { ok: false, error: "Unknown template." };

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: {
        loan: {
          include: {
            customer: { select: { fullName: true, phone: true } },
            installments: { orderBy: { cycleNumber: "asc" } },
            payments: {
              select: { amount: true, installmentId: true },
            },
          },
        },
      },
    });
    if (!payment) return { ok: false, error: "Payment not found." };

    const loan = payment.loan;
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments,
    });

    const settled = state.principalOutstanding.lte(0);
    const effectiveKey = settled && templateKey === "payment_received"
      ? "loan_settled"
      : templateKey;
    const effective = getTemplate(effectiveKey) ?? template;

    const message = renderMessage(effective.body, {
      customerName: loan.customer.fullName,
      loanRef: loanRef(loan.id),
      amountReceived: tsh(payment.amount),
      method: payment.method,
      paidAt: formatDateTime(payment.paidAt),
      remainingBalance: tsh(state.principalOutstanding),
      totalRepaid: tsh(state.totalCollected),
    });

    return {
      ok: true,
      message,
      customerName: loan.customer.fullName,
      phoneE164: loan.customer.phone,
      loanRef: loanRef(loan.id),
    };
  } catch (err) {
    console.error("[previewPaymentMessage]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not build receipt: ${err.message}`
          : "Could not build receipt.",
    };
  }
}

/**
 * Render a customer-context template (loan declined, general receipt).
 * Extras carry the transaction values for the general receipt case.
 */
export async function previewCustomerMessage(
  customerId: string,
  templateKey: string,
  extras: Record<string, string> = {},
): Promise<MessagePreview | MessageError> {
  try {
    const _u = await requireUser();
    if (_u.role === "DEMO_VIEWER") return { ok: false, error: "Not available in demo mode." };
    const template = getTemplate(templateKey);
    if (!template) return { ok: false, error: "Unknown template." };

    // Consolidated referral notice: one message covering every overdue /
    // defaulted loan for this borrower, sent to the referral.
    if (templateKey === "referral_overdue_all") {
      const summary = await getReferralOverdue(customerId);
      if (!summary) return { ok: false, error: "Customer not found." };
      if (!summary.referralPhone) {
        return {
          ok: false,
          error:
            "No referral is on file for this customer. Add a referral (name + phone) on the customer profile first.",
        };
      }
      if (summary.loans.length === 0) {
        return {
          ok: false,
          error: `${summary.borrowerName} has no overdue or defaulted loans right now.`,
        };
      }
      const chosen = pickOverdue(summary, parseLoanIds(extras.loanIds));
      if (chosen.loans.length === 0) {
        return { ok: false, error: "Switch on at least one loan to include." };
      }
      const pay = await getPaymentDetails();
      return {
        ok: true,
        message: buildReferralMessage(chosen, pay),
        customerName: summary.referralName || "Referral",
        phoneE164: summary.referralPhone,
        loanRef: null,
        referralLoans: summary.loans.map((l) => ({
          loanId: l.loanId,
          loanRef: l.loanRef,
          dueDate: formatDate(l.dueDate),
          days: l.daysOverdue,
          when: `${l.daysOverdue} day(s) overdue`,
          amount: `TSh ${tsh(l.amountDue)}`,
        })),
      };
    }

    // Consolidated heads-up: every upcoming payment for this borrower.
    if (templateKey === "referral_upcoming_all") {
      const summary = await getReferralUpcoming(customerId);
      if (!summary) return { ok: false, error: "Customer not found." };
      if (!summary.referralPhone) {
        return {
          ok: false,
          error:
            "No referral is on file for this customer. Add a referral (name + phone) on the customer profile first.",
        };
      }
      if (summary.loans.length === 0) {
        return {
          ok: false,
          error: `${summary.borrowerName} has no upcoming payments right now.`,
        };
      }
      const chosen = pickUpcoming(summary, parseLoanIds(extras.loanIds));
      if (chosen.loans.length === 0) {
        return { ok: false, error: "Switch on at least one loan to include." };
      }
      const pay = await getPaymentDetails();
      return {
        ok: true,
        message: buildReferralUpcomingMessage(chosen, pay),
        customerName: summary.referralName || "Referral",
        phoneE164: summary.referralPhone,
        loanRef: null,
        referralLoans: summary.loans.map((l) => ({
          loanId: l.loanId,
          loanRef: l.loanRef,
          dueDate: formatDate(l.dueDate),
          days: l.daysUntilDue,
          when: dueWhen(l.daysUntilDue),
          amount: `TSh ${tsh(l.minimumDue)}`,
        })),
      };
    }

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, fullName: true, phone: true },
    });
    if (!customer) return { ok: false, error: "Customer not found." };

    const message = renderMessage(template.body, {
      customerName: customer.fullName,
      reference: extras.reference ?? "",
      amount: extras.amount ? tsh(extras.amount) : "",
      date: extras.date ?? formatDate(new Date()),
      description: extras.description ?? "",
      principal: extras.principal ? tsh(extras.principal) : "",
    });

    return {
      ok: true,
      message,
      customerName: customer.fullName,
      phoneE164: customer.phone,
      loanRef: null,
    };
  } catch (err) {
    console.error("[previewCustomerMessage]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not build message: ${err.message}`
          : "Could not build message.",
    };
  }
}
