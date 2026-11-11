import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { MATCH_THRESHOLD, matchScore, paymentHint } from "@/lib/ai/match";

// Customer suggestions for something Lendo AI read (a receipt or a statement
// line): who it probably is, and that person's open loans.

export type OpenLoanSuggestion = {
  loanId: string;
  ref: string;
  principal: number;
  givenOn: string;
  interestOnly: number;
  settlement: number;
  cycle: number | null;
  hint: string | null;
};

export type CustomerSuggestion = {
  id: string;
  name: string;
  phone: string;
  score: number;
  reasons: string[];
  openLoans: OpenLoanSuggestion[];
};

export type CustomerLite = {
  id: string;
  fullName: string;
  businessName: string | null;
  phone: string;
  altPhone: string | null;
};

export function loanRef(id: string) {
  return "LND-" + id.slice(-6).toUpperCase();
}

export async function loadCustomers(): Promise<CustomerLite[]> {
  return db.customer.findMany({
    select: { id: true, fullName: true, businessName: true, phone: true, altPhone: true },
  });
}

/** Top matches for each query, with open loans — one loan query for all. */
export async function suggestCustomers(
  customers: CustomerLite[],
  queries: { name: string | null; account: string | null; amount: number | null }[],
): Promise<CustomerSuggestion[][]> {
  const scoredPerQuery = queries.map((q) =>
    customers
      .map((c) => ({ c, ...matchScore({ name: q.name, account: q.account }, c) }))
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  );
  const ids = [...new Set(scoredPerQuery.flat().map((s) => s.c.id))];
  const loans = ids.length
    ? await db.loan.findMany({
        where: { customerId: { in: ids }, status: { notIn: ["SETTLED", "WRITTEN_OFF"] } },
        orderBy: { disbursedAt: "asc" },
        include: {
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: { select: { amount: true, installmentId: true } },
        },
      })
    : [];
  const states = new Map(
    loans.map((l) => {
      const st = computeLoanState({
        principal: l.principal,
        status: l.status,
        interestRatePct: l.interestRatePct,
        installments: l.installments,
        payments: l.payments,
      });
      return [l.id, st] as const;
    }),
  );

  return scoredPerQuery.map((scored, qi) =>
    scored.map(({ c, score, reasons }) => ({
      id: c.id,
      name: c.fullName,
      phone: c.phone,
      score,
      reasons,
      openLoans: loans
        .filter((l) => l.customerId === c.id)
        .map((l) => {
          const st = states.get(l.id)!;
          const interestOnly = st.interestOnlyNow.toNumber();
          const settlement = st.settlementAmountNow.toNumber();
          return {
            loanId: l.id,
            ref: loanRef(l.id),
            principal: Number(l.principal),
            givenOn: l.disbursedAt.toISOString().slice(0, 10),
            interestOnly,
            settlement,
            cycle: st.currentCycle,
            hint: paymentHint(queries[qi].amount, { interestOnly, settlement, cycle: st.currentCycle }),
          };
        })
        .filter((l) => l.settlement > 0),
    })),
  );
}
