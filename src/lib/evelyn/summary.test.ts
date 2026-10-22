import { describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import { money } from "@/lib/money";
import { attributeInterest, computePeriodMetrics } from "@/lib/reporting";
import { checkBearer } from "@/lib/bearer";
import { buildEvelynSummary, type SummaryLoan } from "@/lib/evelyn/summary";
import type { LoanStatus } from "@/generated/prisma/enums";

// The summary builder is pure; only its loader touches the database.
vi.mock("@/lib/db", () => ({ db: {} }));

type Pay = { cycle: number | null; amount: number; on: string };

function loan(
  id: string,
  name: string,
  principal: number,
  disbursed: string,
  pays: Pay[] = [],
  status: LoanStatus = "ACTIVE",
): SummaryLoan {
  const schedule = generateSchedule({
    principal,
    disbursedAt: parseIsoDate(disbursed),
  });
  const installments = schedule.installments.map((i) => ({
    id: `${id}-c${i.cycleNumber}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: i.expectedInterest,
    expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
    status: "PENDING" as const,
  }));
  return {
    id,
    status,
    principal: new Decimal(principal),
    interestRatePct: 15,
    cyclesAllowed: 3,
    disbursedAt: schedule.disbursedAt,
    dueAt: schedule.dueAt,
    customer: {
      id: `cust-${id}`,
      fullName: name,
      phone: "+255700000001",
      riskScore: 80,
      riskBand: "GOOD",
      referralName: "Referee Person",
      referralPhone: "+255700000002",
    },
    installments,
    payments: pays.map((p, n) => {
      const inst = p.cycle ? installments[p.cycle - 1] : null;
      return {
        id: `${id}-p${n}`,
        amount: money(p.amount),
        installmentId: inst?.id ?? null,
        paidAt: parseIsoDate(p.on),
        createdAt: parseIsoDate(p.on),
        method: "CASH",
        recordedBy: null,
        installment: inst ? { dueDate: inst.dueDate } : null,
      };
    }),
  };
}

// Thursday 22 October 2026 in Dar es Salaam.
const today = parseIsoDate("2026-10-22");

const loans: SummaryLoan[] = [
  // First cycle due today (disbursed 30 days ago).
  loan("aaaaaa", "Asha Juma", 1_000_000, "2026-09-22"),
  // Final cycle in 3 days; earlier cycles' interest paid.
  loan("bbbbbb", "Baraka Mosi", 500_000, "2026-07-27", [
    { cycle: 1, amount: 75_000, on: "2026-08-26" },
    { cycle: 2, amount: 75_000, on: "2026-09-25" },
  ]),
  // Missed its first cycle on 10 October.
  loan("cccccc", "Chausiku Ali", 1_000_000, "2026-09-10"),
  // Paid every cycle's interest but not the principal: defaulted on 18 October.
  loan("dddddd", "Daudi Peter", 400_000, "2026-07-20", [
    { cycle: 1, amount: 60_000, on: "2026-08-19" },
    { cycle: 2, amount: 60_000, on: "2026-09-18" },
    { cycle: 3, amount: 60_000, on: "2026-10-18" },
  ]),
  // Settled this week.
  loan(
    "eeeeee",
    "Esther Kim",
    200_000,
    "2026-09-25",
    [{ cycle: 1, amount: 230_000, on: "2026-10-21" }],
    "SETTLED",
  ),
  // Lent this week.
  loan("ffffff", "Faraji Said", 300_000, "2026-10-20"),
];

const summary = buildEvelynSummary({
  loans,
  customers: [],
  cashPool: {
    principalOutstanding: new Decimal(3_200_000),
    cashOnHand: new Decimal(750_000),
  },
  tithes: {
    ratePct: 10,
    submissions: [
      {
        period: "2026-09",
        amount: "13500.00",
        submittedAt: new Date("2026-10-02T08:00:00Z"),
      },
    ],
  },
  today,
  now: new Date("2026-10-22T02:00:00Z"),
});

describe("Evelyn summary", () => {
  it("lists unpaid cycles due from today up to 7 days ahead", () => {
    expect(summary.today).toBe("2026-10-22");
    expect(summary.upcoming).toEqual([
      {
        loanRef: "LND-AAAAAA",
        borrower: "Asha Juma",
        dueDate: "2026-10-22",
        cycle: 1,
        cycles: 3,
        finalCycle: false,
        interest: "150000.00",
        principal: "0.00",
      },
      {
        loanRef: "LND-BBBBBB",
        borrower: "Baraka Mosi",
        dueDate: "2026-10-25",
        cycle: 3,
        cycles: 3,
        finalCycle: true,
        interest: "75000.00",
        principal: "500000.00",
      },
    ]);
  });

  it("treats a cycle due today as due, not overdue", () => {
    expect(summary.overdue.map((o) => o.borrower)).not.toContain("Asha Juma");
  });

  it("lists overdue loans, most overdue first, with what they owe", () => {
    expect(summary.overdue).toEqual([
      {
        loanRef: "LND-CCCCCC",
        borrower: "Chausiku Ali",
        kind: "missed_cycle",
        since: "2026-10-10",
        daysLate: 12,
        amountDue: "150000.00",
        daysPastFinalDate: 0,
      },
      {
        loanRef: "LND-DDDDDD",
        borrower: "Daudi Peter",
        kind: "defaulted",
        since: "2026-10-18",
        daysLate: 4,
        amountDue: "400000.00",
        daysPastFinalDate: 4,
      },
    ]);
    expect(summary.totals).toEqual({
      outstanding: "3200000.00",
      overdue: "550000.00",
      overdueLoans: 2,
      cashAvailable: "750000.00",
    });
  });

  it("sums the week (Monday to Sunday) and the week before", () => {
    expect(summary.week).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
      lent: "300000.00",
      loansLent: 1,
      collected: "230000.00",
      interest: "30000.00",
      principal: "200000.00",
    });
    expect(summary.previousWeek).toMatchObject({
      start: "2026-10-12",
      end: "2026-10-18",
      lent: "0.00",
      collected: "60000.00",
      interest: "60000.00",
      principal: "0.00",
    });
  });

  it("uses the same sums as the Reports page", () => {
    const byPayment = new Map<string, Decimal>();
    for (const l of loans)
      for (const [id, part] of attributeInterest(l)) byPayment.set(id, part);
    const m = computePeriodMetrics(
      loans,
      [],
      byPayment,
      parseIsoDate("2026-10-19"),
      parseIsoDate("2026-10-26"),
    );
    expect(m.collected.toFixed(2)).toBe(summary.week.collected);
    expect(m.interestIncome.toFixed(2)).toBe(summary.week.interest);
    expect(m.disbursed.toFixed(2)).toBe(summary.week.lent);
  });

  it("reports this month's tithe and earlier months still to submit", () => {
    expect(summary.tithe).toEqual({
      month: "2026-10",
      interest: "90000.00",
      ratePct: 10,
      amount: "9000.00",
      submitted: false,
      submittedOn: null,
      submittedAmount: null,
    });
    expect(summary.pendingTithes).toEqual([
      { month: "2026-08", amount: "13500.00" },
    ]);
  });

  it("carries no phone numbers or referral details", () => {
    const json = JSON.stringify(summary);
    expect(json).not.toContain("+255");
    expect(json).not.toContain("Referee");
    expect(json).not.toContain("cust-");
  });
});

describe("checkBearer", () => {
  const secret = "s".repeat(40);
  it("accepts the right secret only", () => {
    expect(checkBearer(`Bearer ${secret}`, secret)).toBe("ok");
    expect(checkBearer(`bearer ${secret}`, secret)).toBe("ok");
    expect(checkBearer(`Bearer ${secret}x`, secret)).toBe("denied");
    expect(checkBearer(null, secret)).toBe("denied");
    expect(checkBearer(secret, secret)).toBe("denied");
  });
  it("serves nothing when the server's secret is missing or short", () => {
    expect(checkBearer("Bearer short", "short")).toBe("unconfigured");
    expect(checkBearer("Bearer x", undefined)).toBe("unconfigured");
  });
});
