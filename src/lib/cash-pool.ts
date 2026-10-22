import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState, type CalcInstallment } from "@/lib/loan-calc";
import { money } from "@/lib/money";
import type { CapitalType, LoanStatus } from "@/generated/prisma/enums";

// The cash-pool view: where the money came from and where it went. Shared by
// the Capital page and the Evelyn summary so both show the same figures.

type SourceLike = {
  type: CapitalType;
  amount: Decimal | string | { toString(): string };
  repayments: { amount: Decimal | string | { toString(): string } }[];
};

type LoanLike = {
  principal: Decimal | string | { toString(): string };
  status: LoanStatus;
  interestRatePct: number;
  installments: CalcInstallment[];
  payments: {
    amount: Decimal | string | { toString(): string };
    installmentId: string | null;
  }[];
};

export type CashPool<S> = {
  rows: { s: S; amount: Decimal; repaid: Decimal; outstanding: Decimal }[];
  capitalRaised: Decimal;
  capitalRepaid: Decimal;
  /** Borrowed / investment money not yet repaid. */
  capitalOwed: Decimal;
  /** Principal of every loan ever issued. */
  disbursed: Decimal;
  /** Principal still with customers ("Out on loan"), written-off loans excluded. */
  principalOutstanding: Decimal;
  customerCollected: Decimal;
  tithesPaid: Decimal;
  cashIn: Decimal;
  cashOut: Decimal;
  /** Money in minus money out. */
  cashOnHand: Decimal;
};

export function computeCashPool<S extends SourceLike>(input: {
  sources: S[];
  loans: LoanLike[];
  customerCollected: Decimal;
  tithesPaid: Decimal;
}): CashPool<S> {
  let capitalRaised = money(0);
  let capitalRepaid = money(0);
  let capitalOwed = money(0);
  const rows = input.sources.map((s) => {
    const amount = money(s.amount.toString());
    const repaid = s.repayments.reduce(
      (a, r) => a.plus(money(r.amount.toString())),
      money(0),
    );
    const outstanding = amount.minus(repaid);
    capitalRaised = capitalRaised.plus(amount);
    capitalRepaid = capitalRepaid.plus(repaid);
    if (s.type === "BORROWED" || s.type === "INVESTMENT") {
      capitalOwed = capitalOwed.plus(
        outstanding.gt(0) ? outstanding : money(0),
      );
    }
    return { s, amount, repaid, outstanding };
  });

  let disbursed = money(0);
  let principalOutstanding = money(0);
  for (const loan of input.loans) {
    disbursed = disbursed.plus(money(loan.principal.toString()));
    const state = computeLoanState({
      principal: loan.principal.toString(),
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount.toString(),
        installmentId: p.installmentId,
      })),
    });
    if (loan.status !== "WRITTEN_OFF") {
      principalOutstanding = principalOutstanding.plus(
        state.principalOutstanding,
      );
    }
  }

  const cashIn = capitalRaised.plus(input.customerCollected);
  const cashOut = disbursed.plus(capitalRepaid).plus(input.tithesPaid);
  return {
    rows,
    capitalRaised,
    capitalRepaid,
    capitalOwed,
    disbursed,
    principalOutstanding,
    customerCollected: input.customerCollected,
    tithesPaid: input.tithesPaid,
    cashIn,
    cashOut,
    cashOnHand: cashIn.minus(cashOut),
  };
}

/** Loads everything the cash pool needs, newest capital first. */
export async function loadCashPool() {
  const [sources, loans, paymentsAgg, titheAgg] = await Promise.all([
    db.capitalSource.findMany({
      orderBy: { receivedAt: "desc" },
      include: { repayments: true },
    }),
    db.loan.findMany({
      select: {
        principal: true,
        status: true,
        interestRatePct: true,
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: { select: { amount: true, installmentId: true } },
      },
    }),
    db.payment.aggregate({ _sum: { amount: true } }),
    db.tithePayment.aggregate({ _sum: { amount: true } }),
  ]);
  return computeCashPool({
    sources,
    loans,
    customerCollected: money(paymentsAgg._sum.amount?.toString() ?? "0"),
    tithesPaid: money(titheAgg._sum.amount?.toString() ?? "0"),
  });
}
