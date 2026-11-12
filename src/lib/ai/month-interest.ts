import Decimal from "decimal.js";
import { computeLoanState } from "@/lib/loan-calc";
import { attributeInterest, type LoanFull } from "@/lib/reporting";
import type { LoanStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Interest for a calendar month, worked out exactly in code so Lendo AI never
// has to add numbers up itself.
//
//   collected       = interest inside payments received in the month (cash basis)
//   still expected  = interest of rounds due in the month that isn't paid yet
//                     (split into "already late" and "not due yet")
//   projected total = collected + still expected
//                     (= the month's interest if everyone pays the interest due)
//   from earlier    = unpaid interest of rounds due before the month (shown
//                     separately — it belongs to earlier months)
// ---------------------------------------------------------------------------

export type MonthLoan = LoanFull & { status: LoanStatus };

export type MonthInterestRow = {
  customer: string;
  loan: string;
  round: number;
  due: string;
  interest: number;
};

export type MonthInterest = {
  month: string;
  basis: string;
  excluded_customers: string[];
  collected_so_far: number;
  still_expected: number;
  still_expected_late: number;
  still_expected_not_due_yet: number;
  projected_month_total: number;
  overdue_interest_from_earlier_months: number;
  previous_month: string;
  previous_month_collected: number;
  collected_by_customer: { customer: string; interest: number }[];
  still_expected_rounds: (MonthInterestRow & { late: boolean })[];
  earlier_overdue_rounds: MonthInterestRow[];
};

const ref = (id: string) => "LND-" + id.slice(-6).toUpperCase();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r0 = (d: Decimal) => Math.round(d.toNumber());

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Kiswahili month names.
const MONTHS_SW = ["januari", "februari", "machi", "aprili", "mei", "juni", "julai", "agosti", "septemba", "oktoba", "novemba", "desemba"];

/**
 * Understand a month however it is written: "2026-11", "2026-11-01",
 * "November 2026", "Nov 2026", "Novemba 2026", "11/2026". Returns "YYYY-MM",
 * or null when it can't tell (never silently picks another month).
 */
export function parseMonth(input: unknown, today: Date): string | null {
  if (input == null || input === "") return today.toISOString().slice(0, 7);
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (m) return fmt(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return fmt(Number(m[2]), Number(m[1]));
  // "November 2026" / "Nov. 2026" / "2026 November"
  const named = /^([a-z]+)\.?,?\s+(\d{4})$/.exec(t);
  const yearFirst = /^(\d{4})\s+([a-z]+)$/.exec(t);
  const name = named?.[1] ?? yearFirst?.[2];
  const year = named?.[2] ?? yearFirst?.[1];
  if (name && year) {
    const sw = MONTHS_SW.indexOf(name);
    const idx = sw >= 0 ? sw : MONTHS.findIndex((x) => name.startsWith(x));
    if (idx >= 0) return fmt(Number(year), idx + 1);
  }
  return null;
}

function fmt(y: number, mo: number): string | null {
  if (!(y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12)) return null;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function monthBounds(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number);
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1))];
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** Does this customer match one of the names / ids to leave out? */
function isExcluded(c: { id: string; fullName: string }, exclude: string[]): boolean {
  const name = c.fullName.toLowerCase();
  return exclude.some((e) => {
    const x = e.trim().toLowerCase();
    if (!x) return false;
    if (x === c.id.toLowerCase()) return true;
    // Every word given must appear in the name ("Ansbert Rwamahe", "ansbert").
    return x.split(/\s+/).every((w) => name.includes(w));
  });
}

function collectedIn(loans: MonthLoan[], from: Date, to: Date) {
  const byCustomer = new Map<string, Decimal>();
  let total = new Decimal(0);
  for (const l of loans) {
    const interest = attributeInterest(l);
    for (const p of l.payments) {
      if (p.paidAt >= from && p.paidAt < to) {
        const part = interest.get(p.id) ?? new Decimal(0);
        total = total.plus(part);
        byCustomer.set(l.customer.fullName, (byCustomer.get(l.customer.fullName) ?? new Decimal(0)).plus(part));
      }
    }
  }
  return { total, byCustomer };
}

/**
 * @param month  "YYYY-MM"
 * @param today  a Tanzania business date (UTC midnight)
 * @param exclude customer names (or ids) to leave out
 */
export function monthInterest(
  allLoans: MonthLoan[],
  month: string,
  today: Date,
  exclude: string[] = [],
): MonthInterest {
  const [from, to] = monthBounds(month);
  const excludedNames = new Set<string>();
  const loans = allLoans.filter((l) => {
    if (isExcluded(l.customer, exclude)) {
      excludedNames.add(l.customer.fullName);
      return false;
    }
    return true;
  });

  const now = collectedIn(loans, from, to);
  const [pFrom, pTo] = monthBounds(prevMonth(month));
  const before = collectedIn(loans, pFrom, pTo);

  const expected: (MonthInterestRow & { late: boolean })[] = [];
  const earlier: MonthInterestRow[] = [];
  for (const l of loans) {
    if (l.status === "SETTLED" || l.status === "WRITTEN_OFF") continue;
    const state = computeLoanState({
      principal: l.principal,
      status: l.status,
      interestRatePct: l.interestRatePct,
      installments: l.installments,
      payments: l.payments,
    });
    if (state.isSettled) continue;
    const interest = attributeInterest(l);
    const paidPerRound = new Map<string, Decimal>();
    for (const p of l.payments) {
      if (!p.installmentId) continue;
      paidPerRound.set(
        p.installmentId,
        (paidPerRound.get(p.installmentId) ?? new Decimal(0)).plus(interest.get(p.id) ?? 0),
      );
    }
    for (const inst of l.installments) {
      if (inst.dueDate >= to) continue;
      const owed = state.perInstallmentInterestOwed[inst.id] ?? new Decimal(0);
      const unpaid = owed.minus(paidPerRound.get(inst.id) ?? 0);
      if (unpaid.lte(0.5)) continue;
      const row = {
        customer: l.customer.fullName,
        loan: ref(l.id),
        round: inst.cycleNumber,
        due: iso(inst.dueDate),
        interest: r0(unpaid),
      };
      if (inst.dueDate >= from) {
        // Late only once the due date has fully passed (same rule as everywhere).
        expected.push({ ...row, late: inst.dueDate < today });
      } else {
        earlier.push(row);
      }
    }
  }
  expected.sort((a, b) => a.due.localeCompare(b.due) || a.customer.localeCompare(b.customer));
  earlier.sort((a, b) => a.due.localeCompare(b.due));

  const sum = (rows: { interest: number }[]) => rows.reduce((s, r) => s + r.interest, 0);
  const late = sum(expected.filter((e) => e.late));
  const notYet = sum(expected.filter((e) => !e.late));
  const collected = r0(now.total);

  return {
    month,
    basis:
      "collected = interest inside payments received this month; still expected = unpaid interest of rounds due this month; projected = collected + still expected (if everyone pays the interest due).",
    excluded_customers: [...excludedNames],
    collected_so_far: collected,
    still_expected: late + notYet,
    still_expected_late: late,
    still_expected_not_due_yet: notYet,
    projected_month_total: collected + late + notYet,
    overdue_interest_from_earlier_months: sum(earlier),
    previous_month: prevMonth(month),
    previous_month_collected: r0(before.total),
    collected_by_customer: [...now.byCustomer.entries()]
      .map(([customer, v]) => ({ customer, interest: r0(v) }))
      .filter((x) => x.interest > 0)
      .sort((a, b) => b.interest - a.interest),
    still_expected_rounds: expected,
    earlier_overdue_rounds: earlier,
  };
}

type Comparison = { last_month_collected: number; projected_this_month: number; difference: number };

export type MonthInterestReport = MonthInterest & {
  /** This month's projection against last month, worked out on the same basis. */
  vs_last_month: { same_customers: Comparison; all_customers?: Comparison };
  /** Present when customers were left out: who, and what that removed. */
  exclusion?: {
    left_out: string[];
    projected_interest_left_out: number;
    previous_month_collected_from_them: number;
    /** Last month with everyone included — what the business actually earned. */
    previous_month_collected_all_customers: number;
    /** Names that look alike but were NOT left out (different people). */
    similar_names_not_left_out: string[];
    /** Names asked for that matched nobody. */
    not_found: string[];
  };
};

/**
 * The month's interest with any exclusions spelled out, so nobody has to guess
 * whether "except Ansbert" applied, or to whom.
 */
export function monthInterestReport(
  loans: MonthLoan[],
  month: string,
  today: Date,
  exclude: string[] = [],
): MonthInterestReport {
  const result = monthInterest(loans, month, today, exclude);
  const compare = (r: MonthInterest): Comparison => ({
    last_month_collected: r.previous_month_collected,
    projected_this_month: r.projected_month_total,
    difference: r.projected_month_total - r.previous_month_collected,
  });
  const asked = exclude.map((e) => e.trim()).filter(Boolean);
  if (!asked.length) return { ...result, vs_last_month: { same_customers: compare(result) } };
  const everyone = monthInterest(loans, month, today);
  const left = new Set(result.excluded_customers);
  const words = asked.flatMap((e) => e.toLowerCase().split(/\s+/)).filter((w) => w.length >= 3);
  const similar = [...new Set(loans.map((l) => l.customer.fullName))].filter(
    (n) => !left.has(n) && words.some((w) => n.toLowerCase().split(/\s+/).includes(w)),
  );
  return {
    ...result,
    vs_last_month: { same_customers: compare(result), all_customers: compare(everyone) },
    exclusion: {
      left_out: result.excluded_customers,
      projected_interest_left_out: everyone.projected_month_total - result.projected_month_total,
      previous_month_collected_from_them: everyone.previous_month_collected - result.previous_month_collected,
      previous_month_collected_all_customers: everyone.previous_month_collected,
      similar_names_not_left_out: similar,
      not_found: asked.filter(
        (e) => ![...left].some((n) => e.toLowerCase().split(/\s+/).every((w) => n.toLowerCase().includes(w))),
      ),
    },
  };
}
