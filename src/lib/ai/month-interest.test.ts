import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import { monthInterest, type MonthLoan } from "@/lib/ai/month-interest";

let seq = 0;
/** A loan with its schedule; `paid` = [round, amount, paidOn] payments. */
function loan(
  customer: string,
  principal: number,
  disbursed: string,
  paid: [number, number, string][] = [],
  status: MonthLoan["status"] = "ACTIVE",
): MonthLoan {
  const id = `loan${++seq}xxxxxx`;
  const s = generateSchedule({ principal, disbursedAt: parseIsoDate(disbursed) });
  const installments = s.installments.map((i) => ({
    id: `${id}-r${i.cycleNumber}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: new Decimal(i.expectedInterest),
    expectedPrincipalAtThisCycle: new Decimal(i.expectedPrincipalAtThisCycle),
    status: "PENDING" as const,
  }));
  return {
    id,
    principal: new Decimal(principal),
    interestRatePct: 15,
    cyclesAllowed: 3,
    disbursedAt: s.disbursedAt,
    dueAt: s.dueAt,
    status,
    customer: { id: `c-${customer}`, fullName: customer, phone: "", riskScore: 100, riskBand: "EXCELLENT", referralName: null, referralPhone: null },
    installments,
    payments: paid.map(([round, amount, on], k) => ({
      id: `${id}-p${k}`,
      amount: new Decimal(amount),
      installmentId: `${id}-r${round}`,
      paidAt: parseIsoDate(on),
      createdAt: parseIsoDate(on),
      method: "BANK",
      recordedBy: null,
      installment: null,
    })),
  } as MonthLoan;
}

const TODAY = parseIsoDate("2026-11-12");

// Stephen: 500k loan whose round was due 2 Nov (unpaid, late) — 75,000
const stephenLate = loan("Stephen Budoya", 500000, "2026-10-03");
// Stephen: 200k loan, rounds 1–2 paid (Sep/Oct), round 3 due 13 Nov — 30,000
const stephenFinal = loan("Stephen Budoya", 200000, "2026-08-15", [[1, 30000, "2026-09-10"], [2, 30000, "2026-10-09"]]);
// Elizabeth: 3M loan, round 1 due 16 Nov — 450,000
const elizabeth = loan("Elizabeth Bayo", 3000000, "2026-10-17");
// Ansbert: 1M loan due 20 Nov — 150,000 (to be excluded)
const ansbert = loan("Ansbert Rwamahe", 1000000, "2026-10-21");
// Grace: paid her round 1 interest on 5 Nov (collected this month); round 2 due 4 Dec
const grace = loan("Grace Mollel", 400000, "2026-10-05", [[1, 60000, "2026-11-05"]]);
// Juma: rounds due 31 Aug, 30 Sep, 30 Oct — nothing paid (interest from earlier months)
const juma = loan("Juma Ali", 100000, "2026-08-01");
// Settled loan paid in October — counts for last month only
const done = loan("Neema Said", 600000, "2026-09-01", [[1, 690000, "2026-10-01"]], "SETTLED");

const ALL = [stephenLate, stephenFinal, elizabeth, ansbert, grace, juma, done];

describe("interest_for_month", () => {
  it("adds up exactly, splitting late vs not due yet", () => {
    const r = monthInterest(ALL, "2026-11", TODAY);
    expect(r.collected_so_far).toBe(60000); // Grace
    expect(r.still_expected_late).toBe(75000); // Stephen, due 2 Nov
    expect(r.still_expected_not_due_yet).toBe(30000 + 450000 + 150000); // Stephen 13th, Elizabeth, Ansbert
    expect(r.projected_month_total).toBe(60000 + 75000 + 630000);
    expect(r.overdue_interest_from_earlier_months).toBe(3 * 15000); // Juma's three unpaid rounds
    expect(r.earlier_overdue_rounds.map((x) => x.due)).toEqual(["2026-08-31", "2026-09-30", "2026-10-30"]);
    expect(r.previous_month_collected).toBe(30000 + 90000); // Stephen in Oct + Neema's interest
  });

  it("leaves out a named customer", () => {
    const r = monthInterest(ALL, "2026-11", TODAY, ["Ansbert Rwamahe"]);
    expect(r.excluded_customers).toEqual(["Ansbert Rwamahe"]);
    expect(r.still_expected_not_due_yet).toBe(30000 + 450000);
    expect(r.projected_month_total).toBe(60000 + 75000 + 480000);
    expect(r.still_expected_rounds.map((x) => x.customer)).not.toContain("Ansbert Rwamahe");
  });

  it("a round due today is not late yet", () => {
    const r = monthInterest([stephenFinal], "2026-11", parseIsoDate("2026-11-13"));
    expect(r.still_expected_rounds[0]).toMatchObject({ due: "2026-11-13", interest: 30000, late: false });
  });

  it("an interest payment moves money from 'expected' to 'collected' without double counting", () => {
    const paidEarly = loan("Elizabeth Bayo", 3000000, "2026-10-17", [[1, 450000, "2026-11-10"]]);
    const r = monthInterest([paidEarly], "2026-11", TODAY);
    expect(r.collected_so_far).toBe(450000);
    expect(r.still_expected).toBe(0);
    expect(r.projected_month_total).toBe(450000);
  });
});

import { parseMonth } from "@/lib/ai/month-interest";

describe("parseMonth — however the month is written", () => {
  it.each([
    [undefined, "2026-11"],
    ["2026-11", "2026-11"],
    ["2026-10-01", "2026-10"],
    ["November 2026", "2026-11"], // what Haiku actually sent
    ["Oct 2026", "2026-10"],
    ["Novemba 2026", "2026-11"],
    ["2026 October", "2026-10"],
    ["10/2026", "2026-10"],
  ])("%s → %s", (input, out) => {
    expect(parseMonth(input, TODAY)).toBe(out);
  });
  it("says it can't tell instead of guessing", () => {
    expect(parseMonth("last month", TODAY)).toBeNull();
    expect(parseMonth("2026-13", TODAY)).toBeNull();
  });
});

import { monthInterestReport } from "@/lib/ai/month-interest";

describe("monthInterestReport — exclusions spelled out", () => {
  const lookAlike = loan("Ansbert Test", 200000, "2026-10-21"); // a different Ansbert, due 20 Nov — 30,000
  const ansbertOct = loan("Ansbert Rwamahe", 1000000, "2026-09-21", [[1, 150000, "2026-10-20"]]); // 150k in Oct, 150k due 20 Nov
  const loans = [stephenFinal, elizabeth, ansbertOct, lookAlike];
  it("says who was left out, how much, and keeps last month's full figure", () => {
    const r = monthInterestReport(loans, "2026-11", TODAY, ["Ansbert Rwamahe"]);
    expect(r.exclusion).toEqual({
      left_out: ["Ansbert Rwamahe"],
      projected_interest_left_out: 150000,
      previous_month_collected_from_them: 150000,
      previous_month_collected_all_customers: 30000 + 150000,
      similar_names_not_left_out: ["Ansbert Test"],
      not_found: [],
    });
    expect(r.projected_month_total).toBe(30000 + 450000 + 30000);
    // Like-for-like comparisons, worked out in code.
    expect(r.vs_last_month.same_customers).toEqual({ last_month_collected: 30000, projected_this_month: 510000, difference: 480000 });
    expect(r.vs_last_month.all_customers).toEqual({ last_month_collected: 180000, projected_this_month: 660000, difference: 480000 });
  });
  it("reports a name that matched nobody", () => {
    expect(monthInterestReport(loans, "2026-11", TODAY, ["Rehema"]).exclusion?.not_found).toEqual(["Rehema"]);
  });
  it("no exclusion block when nobody is excluded", () => {
    expect(monthInterestReport(loans, "2026-11", TODAY).exclusion).toBeUndefined();
  });
});
