import { describe, it, expect } from "vitest";
import { computeLoanState, type LoanStateInput } from "@/lib/loan-calc";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";

function baseLoan(): LoanStateInput {
  const schedule = generateSchedule({
    principal: 100000,
    disbursedAt: parseIsoDate("2026-06-29"),
  });
  return {
    principal: "100000",
    status: "ACTIVE",
    installments: schedule.installments.map((i, idx) => ({
      id: `inst${idx + 1}`,
      cycleNumber: i.cycleNumber,
      dueDate: i.dueDate,
      expectedInterest: i.expectedInterest,
      expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
      status: "PENDING",
    })),
    payments: [],
  };
}

describe("computeLoanState", () => {
  it("reports full principal outstanding with no payments", () => {
    const s = computeLoanState(baseLoan());
    expect(s.principalOutstanding.toFixed(2)).toBe("100000.00");
    expect(s.totalCollected.toFixed(2)).toBe("0.00");
    expect(s.settlementAmountNow.toFixed(2)).toBe("115000.00");
    expect(s.currentCycle).toBe(1);
    expect(s.isSettled).toBe(false);
  });

  it("treats an interest-only payment as rolled, principal still owed", () => {
    const loan = baseLoan();
    loan.installments[0].status = "INTEREST_PAID";
    loan.payments = [{ amount: "15000", installmentId: "inst1" }];
    const s = computeLoanState(loan);
    expect(s.interestCollected.toFixed(2)).toBe("15000.00");
    expect(s.principalCollected.toFixed(2)).toBe("0.00");
    expect(s.principalOutstanding.toFixed(2)).toBe("100000.00");
    expect(s.isSettled).toBe(false);
    expect(s.currentCycle).toBe(2);
  });

  it("settles the loan when a full settlement payment clears principal", () => {
    const loan = baseLoan();
    loan.installments[0].status = "INTEREST_PAID";
    loan.installments[1].status = "SETTLED";
    loan.status = "SETTLED";
    loan.payments = [
      { amount: "15000", installmentId: "inst1" },
      { amount: "115000", installmentId: "inst2" },
    ];
    const s = computeLoanState(loan);
    expect(s.totalCollected.toFixed(2)).toBe("130000.00");
    expect(s.principalCollected.toFixed(2)).toBe("100000.00");
    expect(s.interestCollected.toFixed(2)).toBe("30000.00");
    expect(s.principalOutstanding.toFixed(2)).toBe("0.00");
    expect(s.isSettled).toBe(true);
    expect(s.currentCycle).toBeNull();
    expect(s.settlementAmountNow.toFixed(2)).toBe("0.00");
  });
});
