import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { loanSituation, dueWhenText } from "@/lib/loan-situation";
import { MATCH_THRESHOLD, bestLoanFit, matchScore, paymentHint } from "@/lib/ai/match";

// Customer suggestions for something Lendo AI read (a receipt or a statement
// line): who it probably is, and that person's open loans — plus, for when the
// receipt doesn't say who paid, every open loan to pick from.

export type OpenLoanSuggestion = {
  loanId: string;
  ref: string;
  principal: number;
  givenOn: string;
  interestOnly: number;
  settlement: number;
  /** Least due by the due date (interest, or the full balance on the final round). */
  minimumDue: number;
  cycle: number | null;
  roundsAgreed: number;
  isFinalRound: boolean;
  /** "Round 2 of 3 · due tomorrow, 13 Nov 2026" / "… · 4 days late" */
  dueText: string | null;
  daysUntilDue: number | null;
  hint: string | null;
  /** The amount equals what this loan expects (minimum, interest or full balance). */
  exactAmount: boolean;
  /** Set on the loan this payment most likely belongs to, when a person has several. */
  bestFit: string | null;
};

export type LoanChoice = OpenLoanSuggestion & { customerId: string; customerName: string; phone: string };

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
  /** Accounts this customer has paid from before, as printed on receipts. */
  knownAccounts: string[];
};

export function loanRef(id: string) {
  return "LND-" + id.slice(-6).toUpperCase();
}

export async function loadCustomers(): Promise<CustomerLite[]> {
  const [customers, paidFrom] = await Promise.all([
    db.customer.findMany({
      select: { id: true, fullName: true, businessName: true, phone: true, altPhone: true },
    }),
    db.payment.findMany({
      where: { payerAccount: { not: null } },
      select: { payerAccount: true, loan: { select: { customerId: true } } },
      distinct: ["payerAccount", "loanId"],
    }),
  ]);
  const known = new Map<string, Set<string>>();
  for (const p of paidFrom) {
    const set = known.get(p.loan.customerId) ?? new Set<string>();
    set.add(p.payerAccount!);
    known.set(p.loan.customerId, set);
  }
  return customers.map((c) => ({ ...c, knownAccounts: [...(known.get(c.id) ?? [])] }));
}

const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= 1;

/** Open loans (optionally only these customers'), with where each stands today. */
async function openLoanRows(amount: number | null, customerIds?: string[]): Promise<LoanChoice[]> {
  if (customerIds && customerIds.length === 0) return [];
  const loans = await db.loan.findMany({
    where: {
      status: { notIn: ["SETTLED", "WRITTEN_OFF"] },
      ...(customerIds ? { customerId: { in: customerIds } } : {}),
    },
    orderBy: { disbursedAt: "asc" },
    take: 500,
    include: {
      customer: { select: { fullName: true, phone: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: { select: { amount: true, installmentId: true } },
    },
  });
  const rows: LoanChoice[] = [];
  for (const l of loans) {
    const sit = loanSituation(l);
    if (sit.settled) continue;
    const interestOnly = sit.interestDue.toNumber();
    const settlement = sit.toClear.toNumber();
    const minimumDue = sit.minimumDue.toNumber();
    if (settlement <= 0) continue;
    const d = sit.daysUntilDue;
    const when =
      d == null || sit.dueDate == null
        ? null
        : d < 0
          ? `${-d} day(s) late (was due ${formatDate(sit.dueDate)})`
          : `due ${dueWhenText(d)}, ${formatDate(sit.dueDate)}`;
    rows.push({
      customerId: l.customerId,
      customerName: l.customer.fullName,
      phone: l.customer.phone,
      loanId: l.id,
      ref: loanRef(l.id),
      principal: Number(l.principal),
      givenOn: l.disbursedAt.toISOString().slice(0, 10),
      interestOnly,
      settlement,
      minimumDue,
      cycle: sit.round,
      roundsAgreed: sit.roundsAgreed,
      isFinalRound: sit.isFinalRound,
      dueText: sit.round
        ? `Round ${sit.round} of ${sit.roundsAgreed}${sit.isFinalRound ? " (final)" : ""}${when ? ` · ${when}` : ""}`
        : when,
      daysUntilDue: d,
      hint: paymentHint(amount, { interestOnly, settlement, cycle: sit.round, isFinalRound: sit.isFinalRound }),
      exactAmount: !!amount && (near(amount, minimumDue) || near(amount, interestOnly) || near(amount, settlement)),
      bestFit: null,
    });
  }
  return rows;
}

/** Mark the most likely loan for each person who has more than one. */
function markBestFit(rows: LoanChoice[], amount: number | null): void {
  const byCustomer = new Map<string, LoanChoice[]>();
  for (const r of rows) byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), r]);
  for (const list of byCustomer.values()) {
    const best = bestLoanFit(amount, list);
    if (best) list[best.index].bestFit = best.reason;
  }
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
  // Amount-specific fields (hint, exact, best fit) are filled per query below.
  const base = await openLoanRows(null, ids);

  return scoredPerQuery.map((scored, qi) => {
    const amount = queries[qi].amount;
    const rows = base
      .filter((r) => scored.some((s) => s.c.id === r.customerId))
      .map((r) => ({
        ...r,
        hint: paymentHint(amount, {
          interestOnly: r.interestOnly,
          settlement: r.settlement,
          cycle: r.cycle,
          isFinalRound: r.isFinalRound,
        }),
        exactAmount:
          !!amount && (near(amount, r.minimumDue) || near(amount, r.interestOnly) || near(amount, r.settlement)),
        bestFit: null,
      }));
    markBestFit(rows, amount);
    return scored.map(({ c, score, reasons }) => ({
      id: c.id,
      name: c.fullName,
      phone: c.phone,
      score,
      reasons,
      openLoans: rows.filter((r) => r.customerId === c.id).map(stripCustomer),
    }));
  });
}

function stripCustomer(r: LoanChoice): OpenLoanSuggestion {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { customerId, customerName, phone, ...rest } = r;
  return rest;
}

/**
 * Every open loan, for picking by hand when the receipt doesn't say who paid.
 * Loans expecting exactly this amount come first, then by due date.
 */
export async function loanChoices(amount: number | null): Promise<LoanChoice[]> {
  const rows = await openLoanRows(amount);
  // Across different people only the amount says anything about the payer.
  for (const r of rows) r.bestFit = r.exactAmount ? "the amount matches exactly what this loan expects" : null;
  return rows.sort(
    (a, b) =>
      Number(b.exactAmount) - Number(a.exactAmount) ||
      (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999) ||
      a.customerName.localeCompare(b.customerName),
  );
}
