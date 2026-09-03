import { db } from "@/lib/db";
import { nowInTz } from "@/lib/dates";
import {
  computeCreditScore,
  type ScoreLoan,
  type CreditScore,
} from "@/lib/credit-score";

const LOAN_INCLUDE = {
  installments: { orderBy: { cycleNumber: "asc" as const } },
  payments: {
    select: {
      amount: true,
      installmentId: true,
      paidAt: true,
      installment: { select: { dueDate: true } },
    },
  },
};

function toScoreLoans(
  loans: Array<{
    principal: unknown;
    status: ScoreLoan["status"];
    interestRatePct: number;
    cyclesAllowed: number;
    dueAt: Date;
    installments: ScoreLoan["installments"];
    payments: Array<{
      amount: unknown;
      installmentId: string | null;
      paidAt: Date;
      installment: { dueDate: Date } | null;
    }>;
  }>,
): ScoreLoan[] {
  return loans.map((l) => ({
    principal: String(l.principal),
    status: l.status,
    interestRatePct: l.interestRatePct,
    cyclesAllowed: l.cyclesAllowed,
    dueAt: l.dueAt,
    installments: l.installments,
    payments: l.payments.map((p) => ({
      amount: String(p.amount),
      installmentId: p.installmentId,
      paidAt: p.paidAt,
      installmentDueDate: p.installment?.dueDate ?? null,
    })),
  }));
}

/** Recompute and persist a single customer's risk. Safe to call often. */
export async function recomputeCustomerRisk(
  customerId: string,
): Promise<CreditScore | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { loans: { include: LOAN_INCLUDE } },
  });
  if (!customer) return null;

  const result = computeCreditScore(toScoreLoans(customer.loans), nowInTz());

  if (
    customer.riskScore !== result.score ||
    customer.riskBand !== result.band ||
    customer.riskWorstDaysLate !== result.worstDaysLate ||
    customer.autoBlacklisted !== result.autoBlacklisted
  ) {
    await db.customer.update({
      where: { id: customerId },
      data: {
        riskScore: result.score,
        riskBand: result.band,
        riskWorstDaysLate: result.worstDaysLate,
        autoBlacklisted: result.autoBlacklisted,
        riskUpdatedAt: new Date(),
      },
    });
  }
  return result;
}

/** Recompute all customers (used by the deploy seed and any backfill). */
export async function recomputeAllRisk(): Promise<number> {
  const customers = await db.customer.findMany({ select: { id: true } });
  for (const c of customers) {
    await recomputeCustomerRisk(c.id);
  }
  return customers.length;
}
