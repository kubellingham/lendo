"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { computeLoanState } from "@/lib/loan-calc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getTemplate, renderMessage } from "@/lib/message-templates";

export type MessagePreview = {
  ok: true;
  message: string;
  customerName: string;
  phoneE164: string;
  loanRef: string | null;
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
    await requireUser();
    const template = getTemplate(templateKey);
    if (!template) return { ok: false, error: "Unknown template." };

    const loan = await db.loan.findUnique({
      where: { id: loanId },
      include: {
        customer: {
          select: { fullName: true, phone: true },
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

    const message = renderMessage(template.body, {
      customerName: loan.customer.fullName,
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
    });

    return {
      ok: true,
      message,
      customerName: loan.customer.fullName,
      phoneE164: loan.customer.phone,
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
    await requireUser();
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
    await requireUser();
    const template = getTemplate(templateKey);
    if (!template) return { ok: false, error: "Unknown template." };

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
