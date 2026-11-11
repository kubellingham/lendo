import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { toBusinessDate } from "@/lib/dates";
import { upcomingForLoan } from "@/lib/referral";
import { attributeInterest, type LoanFull } from "@/lib/reporting";
import type { ToolDef } from "@/lib/ai/client";

// ---------------------------------------------------------------------------
// Read-only lookups Lendo AI can use to answer questions ("Ask Lendo").
// None of these change anything. Results are compact JSON for the model.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const STATUS: Record<string, string> = {
  ACTIVE: "active",
  OVERDUE: "overdue",
  DEFAULTED: "defaulted",
  SETTLED: "fully repaid",
  WRITTEN_OFF: "written off",
};

type FullLoan = LoanFull & { status: string; issuedBy: { name: string } };

const n = (d: Decimal | number) => Math.round(Number(d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ref = (id: string) => "LND-" + id.slice(-6).toUpperCase();

export const LENDO_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "find_customers",
      description:
        "Find customers by part of their name or phone number. Returns id, name, phone, Lendo Score, number of open loans and how much they owe now.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Part of a name or phone number" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "customer_details",
      description:
        "Everything about one customer: profile, referral, Lendo Score, and every loan with its rounds, due dates, payments (date, amount, profit), what is late and what they still owe.",
      parameters: {
        type: "object",
        properties: { customer_id: { type: "string" } },
        required: ["customer_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "loans_due_soon",
      description: "Loan payments coming up within the next N days (not yet late), soonest first.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "How many days ahead (default 7)" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "late_loans",
      description: "Loans with a payment that is late right now, most days late first, with the amount owed.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "business_totals",
      description:
        "Totals for a date range: number and amount of loans given, money received, profit (interest earned), principal returned. Plus how much is still owed today.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" },
          to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "top_debtors",
      description: "Customers who owe the most right now.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", description: "How many (default 10)" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_payments",
      description: "Payments received between two dates, newest first, optionally for one customer.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          customer_id: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
];

/** Loads every loan once per question; small business, so this stays fast. */
class LendoData {
  private loans?: Promise<FullLoan[]>;
  all(): Promise<FullLoan[]> {
    this.loans ??= db.loan
      .findMany({
        orderBy: { disbursedAt: "asc" },
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              riskScore: true,
              riskBand: true,
              referralName: true,
              referralPhone: true,
            },
          },
          issuedBy: { select: { name: true } },
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: {
            orderBy: { paidAt: "asc" },
            select: {
              id: true,
              amount: true,
              installmentId: true,
              paidAt: true,
              createdAt: true,
              method: true,
              recordedBy: { select: { name: true } },
              installment: { select: { dueDate: true } },
            },
          },
        },
      })
      .then((x) => x as unknown as FullLoan[]);
    return this.loans;
  }
}

function stateOf(l: FullLoan) {
  return computeLoanState({
    principal: l.principal,
    status: l.status as never,
    interestRatePct: l.interestRatePct,
    installments: l.installments,
    payments: l.payments,
  });
}

function owesNow(l: FullLoan): number {
  if (l.status === "WRITTEN_OFF") return 0;
  const st = stateOf(l);
  return st.isSettled ? 0 : n(st.settlementAmountNow);
}

/** Days the current round is late (0 if not late). */
function daysLate(l: FullLoan, today: Date): number {
  const st = stateOf(l);
  if (st.isSettled || st.currentCycle == null || l.status === "WRITTEN_OFF") return 0;
  const inst = l.installments.find((i) => i.cycleNumber === st.currentCycle);
  if (!inst) return 0;
  return Math.max(0, Math.round((today.getTime() - toBusinessDate(inst.dueDate).getTime()) / DAY));
}

function loanStory(l: FullLoan, today: Date) {
  const st = stateOf(l);
  const profit = attributeInterest(l);
  return {
    loan: ref(l.id),
    given_on: iso(l.disbursedAt),
    amount: n(l.principal),
    rate: `${l.interestRatePct}% per 30-day round`,
    rounds_agreed: l.cyclesAllowed,
    final_due: iso(l.dueAt),
    status: STATUS[l.status] ?? l.status,
    rounds: l.installments.map((i) => ({
      round: i.cycleNumber,
      due: iso(i.dueDate),
      interest_owed: n(st.perInstallmentInterestOwed[i.id] ?? 0),
      paid: n(st.perInstallmentPaid[i.id] ?? 0),
    })),
    payments: l.payments.map((p) => ({
      date: iso(p.paidAt),
      amount: n(p.amount),
      profit: n(profit.get(p.id) ?? 0),
      method: p.method,
      days_after_round_due: p.installment
        ? Math.round((toBusinessDate(p.paidAt).getTime() - toBusinessDate(p.installment.dueDate).getTime()) / DAY)
        : null,
    })),
    total_paid: n(st.totalCollected),
    still_owes_today: owesNow(l),
    days_late_now: daysLate(l, today),
  };
}

function range(args: Record<string, unknown>): [Date, Date] | null {
  const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!ok(args.from) || !ok(args.to)) return null;
  const from = new Date(`${args.from}T00:00:00Z`);
  const to = new Date(`${args.to}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1); // inclusive
  return [from, to];
}

/** Run one tool; always returns a JSON string (errors included). */
export async function runLendoTool(
  name: string,
  rawArgs: string,
  data = new LendoData(),
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON." });
  }
  const today = toBusinessDate(new Date());

  try {
    switch (name) {
      case "find_customers": {
        const q = String(args.query ?? "").trim().toLowerCase();
        if (!q) return JSON.stringify({ error: "Give part of a name or phone." });
        const digits = q.replace(/\D/g, "");
        const customers = await db.customer.findMany({
          select: { id: true, fullName: true, phone: true, riskScore: true, riskBand: true },
        });
        const hits = customers.filter(
          (c) =>
            c.fullName.toLowerCase().includes(q) ||
            q.split(/\s+/).every((w) => c.fullName.toLowerCase().includes(w)) ||
            (digits.length >= 4 && c.phone.replace(/\D/g, "").includes(digits)),
        );
        const loans = await data.all();
        return JSON.stringify(
          hits.slice(0, 10).map((c) => {
            const mine = loans.filter((l) => l.customer.id === c.id);
            return {
              id: c.id,
              name: c.fullName,
              phone: c.phone,
              lendo_score: c.riskScore,
              open_loans: mine.filter((l) => owesNow(l) > 0).length,
              owes_now: mine.reduce((s, l) => s + owesNow(l), 0),
            };
          }),
        );
      }

      case "customer_details": {
        const id = String(args.customer_id ?? "");
        const c = await db.customer.findUnique({
          where: { id },
          select: {
            id: true,
            fullName: true,
            phone: true,
            city: true,
            occupation: true,
            riskScore: true,
            riskBand: true,
            referralName: true,
            referralPhone: true,
            createdAt: true,
          },
        });
        if (!c) return JSON.stringify({ error: "No customer with that id. Use find_customers first." });
        const loans = (await data.all()).filter((l) => l.customer.id === id);
        return JSON.stringify({
          name: c.fullName,
          phone: c.phone,
          city: c.city,
          occupation: c.occupation,
          customer_since: iso(c.createdAt),
          lendo_score: c.riskScore,
          risk: c.riskBand,
          referral: c.referralName ? `${c.referralName} (${c.referralPhone ?? "no phone"})` : null,
          owes_now: loans.reduce((s, l) => s + owesNow(l), 0),
          loans: loans.map((l) => loanStory(l, today)),
        });
      }

      case "loans_due_soon": {
        const days = Math.min(90, Math.max(0, Number(args.days ?? 7) || 7));
        const loans = await data.all();
        const rows = loans
          .map((l) => {
            const u = upcomingForLoan(l as never, today);
            return u && u.daysUntilDue <= days
              ? {
                  customer: l.customer.fullName,
                  phone: l.customer.phone,
                  loan: u.loanRef,
                  due: iso(u.dueDate),
                  in_days: u.daysUntilDue,
                  round: u.cycleNumber,
                  final_round: u.isFinalCycle,
                  minimum_due: n(u.minimumDue),
                  to_clear: n(u.settleAmount),
                }
              : null;
          })
          .filter(Boolean)
          .sort((a, b) => a!.in_days - b!.in_days);
        return JSON.stringify(rows);
      }

      case "late_loans": {
        const loans = await data.all();
        const rows = loans
          .map((l) => ({ l, late: daysLate(l, today), owes: owesNow(l) }))
          .filter((x) => x.late > 0 && x.owes > 0)
          .sort((a, b) => b.late - a.late)
          .map(({ l, late, owes }) => ({
            customer: l.customer.fullName,
            phone: l.customer.phone,
            loan: ref(l.id),
            days_late: late,
            owes_now: owes,
            status: STATUS[l.status] ?? l.status,
            referral: l.customer.referralName,
          }));
        return JSON.stringify(rows);
      }

      case "business_totals": {
        const r = range(args);
        if (!r) return JSON.stringify({ error: "Give from and to as YYYY-MM-DD." });
        const [from, to] = r;
        const loans = await data.all();
        let lent = 0, count = 0, received = 0, profit = 0;
        for (const l of loans) {
          if (l.disbursedAt >= from && l.disbursedAt < to) {
            lent += n(l.principal);
            count++;
          }
          const interest = attributeInterest(l);
          for (const p of l.payments) {
            if (p.paidAt >= from && p.paidAt < to) {
              received += Number(p.amount);
              profit += Number(interest.get(p.id) ?? 0);
            }
          }
        }
        return JSON.stringify({
          from: args.from,
          to: args.to,
          loans_given: count,
          money_lent_out: Math.round(lent),
          money_received: Math.round(received),
          profit_interest: Math.round(profit),
          principal_returned: Math.round(received - profit),
          still_owed_today_all_loans: loans.reduce((s, l) => s + owesNow(l), 0),
        });
      }

      case "top_debtors": {
        const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10) || 10));
        const owed = new Map<string, { name: string; phone: string; owes: number; loans: number }>();
        for (const l of await data.all()) {
          const o = owesNow(l);
          if (o <= 0) continue;
          const e = owed.get(l.customer.id) ?? { name: l.customer.fullName, phone: l.customer.phone, owes: 0, loans: 0 };
          e.owes += o;
          e.loans++;
          owed.set(l.customer.id, e);
        }
        return JSON.stringify(
          [...owed.values()].sort((a, b) => b.owes - a.owes).slice(0, limit),
        );
      }

      case "recent_payments": {
        const r = range(args);
        if (!r) return JSON.stringify({ error: "Give from and to as YYYY-MM-DD." });
        const [from, to] = r;
        const rows: { date: string; customer: string; loan: string; amount: number; profit: number; method: string }[] = [];
        for (const l of await data.all()) {
          if (args.customer_id && l.customer.id !== args.customer_id) continue;
          const interest = attributeInterest(l);
          for (const p of l.payments) {
            if (p.paidAt >= from && p.paidAt < to) {
              rows.push({
                date: iso(p.paidAt),
                customer: l.customer.fullName,
                loan: ref(l.id),
                amount: n(p.amount),
                profit: n(interest.get(p.id) ?? 0),
                method: p.method,
              });
            }
          }
        }
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return JSON.stringify(rows.slice(0, 100));
      }

      default:
        return JSON.stringify({ error: `Unknown tool ${name}.` });
    }
  } catch (err) {
    console.error("[runLendoTool]", name, err);
    return JSON.stringify({ error: "That lookup failed." });
  }
}

export { LendoData };
