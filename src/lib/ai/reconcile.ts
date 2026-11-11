import type { StatementTxn } from "@/lib/ai/statement";
import { matchScore } from "@/lib/ai/match";

// Plain code (no AI): compare statement lines with what Lendo has recorded.

export type LendoPayment = {
  id: string;
  loanId: string;
  loanRef: string;
  amount: number;
  paidOn: string; // YYYY-MM-DD
  method: string;
  reference: string | null;
  customerName: string;
};

export type LendoLoan = {
  id: string;
  ref: string;
  amount: number;
  givenOn: string; // YYYY-MM-DD
  reference: string | null;
  customerName: string;
};

export type ReconStatus =
  | "recorded" // found in Lendo
  | "missing_payment" // money in from a person, not recorded as a payment
  | "missing_loan" // money out to a person, no matching loan
  | "other" // money in/out that doesn't look like lending
  | "ignored"; // bank fees, transfers between own accounts

export type ReconItem = {
  txn: StatementTxn;
  status: ReconStatus;
  matched?: { label: string; href: string; by: "reference" | "amount & date" };
};

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS_APART = 3;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;
}

/** Make the AI's kind agree with the (balance-checked) direction. */
export function normaliseKind(t: StatementTxn): StatementTxn["kind"] {
  if (t.kind === "fee" || t.kind === "internal") return t.kind;
  if (t.dir === "in" && (t.kind === "loan_out" || t.kind === "other_out")) return "other_in";
  if (t.dir === "out" && (t.kind === "payment_in" || t.kind === "other_in")) return "other_out";
  return t.kind;
}

function pick<T extends { id: string; amount: number; reference: string | null; customerName: string }>(
  t: StatementTxn,
  pool: T[],
  used: Set<string>,
  dateOf: (x: T) => string,
): { item: T; by: "reference" | "amount & date" } | null {
  if (t.ref) {
    const byRef = pool.find(
      (x) => !used.has(x.id) && x.reference && x.reference.toLowerCase() === t.ref!.toLowerCase(),
    );
    if (byRef) return { item: byRef, by: "reference" };
  }
  const candidates = pool
    .filter(
      (x) =>
        !used.has(x.id) &&
        Math.abs(x.amount - t.amount) <= 1 &&
        daysApart(dateOf(x), t.date) <= MAX_DAYS_APART,
    )
    .map((x) => ({
      x,
      days: daysApart(dateOf(x), t.date),
      name: matchScore({ name: t.name, account: null }, { fullName: x.customerName, phone: "" }).score,
    }))
    .sort((a, b) => b.name - a.name || a.days - b.days);
  return candidates[0] ? { item: candidates[0].x, by: "amount & date" } : null;
}

export function reconcile(
  txns: StatementTxn[],
  payments: LendoPayment[],
  loans: LendoLoan[],
  period: { from: string; to: string } | null,
): { items: ReconItem[]; lendoOnly: LendoPayment[] } {
  const usedPayments = new Set<string>();
  const usedLoans = new Set<string>();

  const items: ReconItem[] = txns.map((raw) => {
    const txn = { ...raw, kind: normaliseKind(raw) };
    if (txn.kind === "fee" || txn.kind === "internal") return { txn, status: "ignored" };

    if (txn.dir === "in") {
      const m = pick(txn, payments, usedPayments, (p) => p.paidOn);
      if (m) {
        usedPayments.add(m.item.id);
        return {
          txn,
          status: "recorded",
          matched: {
            label: `Payment from ${m.item.customerName} on ${m.item.loanRef}`,
            href: `/loans/${m.item.loanId}`,
            by: m.by,
          },
        };
      }
      return { txn, status: txn.kind === "payment_in" ? "missing_payment" : "other" };
    }

    const m = pick(txn, loans, usedLoans, (l) => l.givenOn);
    if (m) {
      usedLoans.add(m.item.id);
      return {
        txn,
        status: "recorded",
        matched: {
          label: `Loan ${m.item.ref} to ${m.item.customerName}`,
          href: `/loans/${m.item.id}`,
          by: m.by,
        },
      };
    }
    return { txn, status: txn.kind === "loan_out" ? "missing_loan" : "other" };
  });

  // Bank payments Lendo has for this period that aren't on the statement.
  const lendoOnly = period
    ? payments.filter(
        (p) =>
          !usedPayments.has(p.id) &&
          p.method === "BANK" &&
          p.paidOn >= period.from &&
          p.paidOn <= period.to,
      )
    : [];

  return { items, lendoOnly };
}
