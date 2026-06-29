import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate, toIsoDate } from "@/lib/dates";

describe("generateSchedule", () => {
  it("produces three 30-day cycles with 15% interest each for a 100,000 loan", () => {
    const s = generateSchedule({
      principal: 100000,
      disbursedAt: parseIsoDate("2026-06-29"),
    });

    expect(s.installments).toHaveLength(3);
    expect(s.perCycleInterest.toFixed(2)).toBe("15000.00");
    expect(s.maxTotalInterest.toFixed(2)).toBe("45000.00");
    expect(s.maxTotalRepayment.toFixed(2)).toBe("145000.00");

    // Each cycle's interest is 15,000.
    for (const inst of s.installments) {
      expect(inst.expectedInterest.toFixed(2)).toBe("15000.00");
      expect(inst.interestOnlyAmount.toFixed(2)).toBe("15000.00");
      expect(inst.fullSettlementAmount.toFixed(2)).toBe("115000.00");
    }

    // Due dates land at +30 / +60 / +90 days.
    expect(toIsoDate(s.installments[0].dueDate)).toBe("2026-07-29");
    expect(toIsoDate(s.installments[1].dueDate)).toBe("2026-08-28");
    expect(toIsoDate(s.installments[2].dueDate)).toBe("2026-09-27");
    expect(toIsoDate(s.dueAt)).toBe("2026-09-27");
  });

  it("carries principal only on the final mandatory cycle", () => {
    const s = generateSchedule({
      principal: 100000,
      disbursedAt: parseIsoDate("2026-06-29"),
    });
    expect(s.installments[0].expectedPrincipalAtThisCycle.toFixed(2)).toBe("0.00");
    expect(s.installments[1].expectedPrincipalAtThisCycle.toFixed(2)).toBe("0.00");
    expect(s.installments[2].expectedPrincipalAtThisCycle.toFixed(2)).toBe("100000.00");
    expect(s.installments[2].isMandatorySettlement).toBe(true);
    expect(s.installments[0].isMandatorySettlement).toBe(false);
  });

  it("handles month-end disbursal (Jan 31 -> +30 day arithmetic, not month math)", () => {
    const s = generateSchedule({
      principal: 50000,
      disbursedAt: parseIsoDate("2026-01-31"),
    });
    // Plain +30 days from Jan 31 2026 = Mar 02 2026.
    expect(toIsoDate(s.installments[0].dueDate)).toBe("2026-03-02");
    expect(toIsoDate(s.installments[2].dueDate)).toBe("2026-05-01");
  });

  it("handles a leap year February correctly", () => {
    // 2028 is a leap year. Jan 31 + 30 days = Mar 01 (Feb has 29 days).
    const s = generateSchedule({
      principal: 50000,
      disbursedAt: parseIsoDate("2028-01-31"),
    });
    expect(toIsoDate(s.installments[0].dueDate)).toBe("2028-03-01");
  });

  it("rounds interest to 2 decimal places for odd principals", () => {
    const s = generateSchedule({
      principal: 33333,
      disbursedAt: parseIsoDate("2026-06-29"),
    });
    // 15% of 33,333 = 4,999.95
    expect(s.perCycleInterest.toFixed(2)).toBe("4999.95");
  });
});
