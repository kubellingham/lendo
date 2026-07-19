import { describe, it, expect } from "vitest";
import { interestByMonth, monthsRange, type TitheLoan } from "@/lib/tithes";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";

function loanWith(
  principal: string,
  payments: TitheLoan["payments"],
): TitheLoan {
  const schedule = generateSchedule({
    principal: Number(principal),
    disbursedAt: parseIsoDate("2026-01-01"),
  });
  return {
    principal,
    status: "ACTIVE",
    interestRatePct: 15,
    installments: schedule.installments.map((i, idx) => ({
      id: `inst${idx + 1}`,
      cycleNumber: i.cycleNumber,
      dueDate: i.dueDate,
      expectedInterest: i.expectedInterest,
      expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
      status: "PENDING",
    })),
    payments,
  };
}

describe("interestByMonth", () => {
  it("counts interest-first, per calendar month", () => {
    // 1,000,000 loan. Cycle-1 interest owed = 150,000.
    // Pay 150,000 in Jan (all interest) and 400,000 in Feb (all principal).
    const loan = loanWith("1000000", [
      {
        id: "p1",
        amount: "150000",
        installmentId: "inst1",
        paidAt: parseIsoDate("2026-01-31"),
        createdAt: parseIsoDate("2026-01-31"),
      },
      {
        id: "p2",
        amount: "400000",
        installmentId: "inst1",
        paidAt: parseIsoDate("2026-02-15"),
        createdAt: parseIsoDate("2026-02-15"),
      },
    ]);
    const byMonth = interestByMonth([loan]);
    expect(byMonth.get("2026-01")?.toFixed(2)).toBe("150000.00");
    // Second payment is pure principal → no interest that month.
    expect(byMonth.get("2026-02") ?? null).toBeNull();
  });

  it("splits a single mixed payment: interest up to the cap, rest principal", () => {
    // Pay 550,000 in one go against cycle 1 → 150,000 interest, 400,000 principal.
    const loan = loanWith("1000000", [
      {
        id: "p1",
        amount: "550000",
        installmentId: "inst1",
        paidAt: parseIsoDate("2026-01-20"),
        createdAt: parseIsoDate("2026-01-20"),
      },
    ]);
    const byMonth = interestByMonth([loan]);
    expect(byMonth.get("2026-01")?.toFixed(2)).toBe("150000.00");
  });

  it("monthsRange lists earliest..current inclusive, newest first", () => {
    const range = monthsRange("2026-01");
    expect(range[range.length - 1]).toBe("2026-01");
    // Newest first
    expect(range[0] >= range[range.length - 1]).toBe(true);
  });
});
