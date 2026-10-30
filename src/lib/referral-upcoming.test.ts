import { describe, it, expect } from "vitest";
import type { CalcInstallment } from "@/lib/loan-calc";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import {
  upcomingForLoan,
  buildReferralUpcomingMessage,
  dueWhen,
} from "@/lib/referral";

// referral.ts imports the db client; these tests only use the pure helpers.

function loan(payments: { amount: string; installmentId: string }[] = []) {
  const s = generateSchedule({
    principal: 1000000,
    disbursedAt: parseIsoDate("2026-10-01"),
  });
  const installments: CalcInstallment[] = s.installments.map((i, idx) => ({
    id: `inst${idx + 1}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: i.expectedInterest,
    expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
    status: "PENDING" as const,
  }));
  return {
    id: "loan_abc123",
    principal: "1000000",
    status: "ACTIVE" as const,
    interestRatePct: 15,
    cyclesAllowed: 3,
    installments,
    payments,
  };
}

describe("upcomingForLoan", () => {
  it("returns the current cycle with interest as the minimum", () => {
    const l = loan();
    const line = upcomingForLoan(l, parseIsoDate("2026-10-26"))!;
    expect(line).not.toBeNull();
    expect(line.cycleNumber).toBe(1);
    expect(line.daysUntilDue).toBe(5); // due 31 Oct
    expect(line.isFinalCycle).toBe(false);
    expect(line.minimumDue.toString()).toBe("150000");
    expect(line.settleAmount.toString()).toBe("1150000");
  });

  it("returns null once the due date has passed (that's overdue)", () => {
    expect(upcomingForLoan(loan(), parseIsoDate("2026-11-02"))).toBeNull();
  });

  it("moves to the next cycle after interest is paid", () => {
    const l = loan([{ amount: "150000", installmentId: "inst1" }]);
    const line = upcomingForLoan(l, parseIsoDate("2026-11-02"))!;
    expect(line.cycleNumber).toBe(2);
    expect(line.minimumDue.toString()).toBe("150000");
  });

  it("final cycle requires full settlement", () => {
    const l = loan([
      { amount: "150000", installmentId: "inst1" },
      { amount: "150000", installmentId: "inst2" },
    ]);
    const line = upcomingForLoan(l, parseIsoDate("2026-12-05"))!;
    expect(line.isFinalCycle).toBe(true);
    expect(line.minimumDue.toString()).toBe("1150000");
  });
});

describe("buildReferralUpcomingMessage", () => {
  it("mentions the borrower, due date, amounts and payment details", () => {
    const line = upcomingForLoan(loan(), parseIsoDate("2026-10-26"))!;
    const msg = buildReferralUpcomingMessage(
      {
        borrowerName: "Ansbert M.",
        referralName: "Grace",
        loans: [line],
        totalMinimum: line.minimumDue,
        totalToSettle: line.settleAmount,
      },
      { bank: "CRDB BANK", accountName: "Kathleen Kube", accountNumber: "10327855568" },
    );
    expect(msg).toContain("Dear Grace");
    expect(msg).toContain("*Ansbert M.*");
    expect(msg).toContain("in 5 days");
    expect(msg).toContain("TSh 150,000");
    expect(msg).toContain("TSh 1,150,000");
    expect(msg).toContain("10327855568");
  });

  it("dueWhen wording", () => {
    expect(dueWhen(0)).toBe("today");
    expect(dueWhen(1)).toBe("tomorrow");
    expect(dueWhen(4)).toBe("in 4 days");
  });
});

describe("choosing loans for the referral message", () => {
  it("pickUpcoming keeps only chosen loans and recomputes totals", async () => {
    const { pickUpcoming, parseLoanIds } = await import("@/lib/referral");
    const a = upcomingForLoan({ ...loan(), id: "loan_a" }, parseIsoDate("2026-10-26"))!;
    const b = upcomingForLoan({ ...loan(), id: "loan_b" }, parseIsoDate("2026-10-26"))!;
    const all = {
      borrowerName: "X",
      referralName: "Y",
      referralPhone: "+255700000000",
      loans: [a, b],
      totalMinimum: a.minimumDue.plus(b.minimumDue),
      totalToSettle: a.settleAmount.plus(b.settleAmount),
    };
    expect(pickUpcoming(all, undefined).loans).toHaveLength(2);
    const one = pickUpcoming(all, parseLoanIds("loan_b"));
    expect(one.loans.map((l) => l.loanId)).toEqual(["loan_b"]);
    expect(one.totalMinimum.toString()).toBe("150000");
    expect(one.totalToSettle.toString()).toBe("1150000");
    expect(pickUpcoming(all, parseLoanIds("")).loans).toHaveLength(0);
  });
});
