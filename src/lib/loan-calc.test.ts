import { describe, it, expect } from "vitest";
import { computeLoanState, type LoanStateInput } from "@/lib/loan-calc";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";

function baseLoan(principal = "100000"): LoanStateInput {
  const schedule = generateSchedule({
    principal: Number(principal),
    disbursedAt: parseIsoDate("2026-06-29"),
  });
  return {
    principal,
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
    // Rolled interest-only → cycle 2 interest is still 15% × unchanged principal.
    expect(s.perInstallmentInterestOwed["inst2"].toFixed(2)).toBe("15000.00");
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

  it("reduces next cycle's interest when principal is paid down early (Rashid)", () => {
    // P = 1,000,000. Cycle 1 pay 550,000 → 150k interest + 400k principal
    // → new opening principal = 600,000 → cycle 2 interest = 90,000.
    const loan = baseLoan("1000000");
    loan.payments = [{ amount: "550000", installmentId: "inst1" }];
    const s = computeLoanState(loan);

    expect(s.perInstallmentInterestOwed["inst1"].toFixed(2)).toBe("150000.00");
    expect(s.perInstallmentInterestOwed["inst2"].toFixed(2)).toBe("90000.00");
    expect(s.perInstallmentInterestOwed["inst3"].toFixed(2)).toBe("90000.00");
    expect(s.perInstallmentOpeningPrincipal["inst2"].toFixed(2)).toBe("600000.00");

    expect(s.interestCollected.toFixed(2)).toBe("150000.00");
    expect(s.principalCollected.toFixed(2)).toBe("400000.00");
    expect(s.principalOutstanding.toFixed(2)).toBe("600000.00");
    expect(s.currentCycle).toBe(2);
    // Settlement in cycle 2 = 600,000 principal + 90,000 interest.
    expect(s.interestOnlyNow.toFixed(2)).toBe("90000.00");
    expect(s.settlementAmountNow.toFixed(2)).toBe("690000.00");
    expect(s.isSettled).toBe(false);
  });

  it("finishes the Rashid flow: settles fully after paying 690k in cycle 2", () => {
    const loan = baseLoan("1000000");
    loan.installments[0].status = "INTEREST_PAID";
    loan.payments = [
      { amount: "550000", installmentId: "inst1" },
      { amount: "690000", installmentId: "inst2" },
    ];
    const s = computeLoanState(loan);
    expect(s.interestCollected.toFixed(2)).toBe("240000.00");
    expect(s.principalCollected.toFixed(2)).toBe("1000000.00");
    expect(s.principalOutstanding.toFixed(2)).toBe("0.00");
    expect(s.isSettled).toBe(true);
  });

  it("allows partial principal paydown mid-cycle", () => {
    // Pay 300k in cycle 1: 150k interest + 150k principal → new principal 850k
    // → cycle 2 interest = 127,500.
    const loan = baseLoan("1000000");
    loan.payments = [{ amount: "300000", installmentId: "inst1" }];
    const s = computeLoanState(loan);
    expect(s.perInstallmentInterestOwed["inst2"].toFixed(2)).toBe("127500.00");
    expect(s.principalOutstanding.toFixed(2)).toBe("850000.00");
  });
});
