import { describe, it, expect } from "vitest";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { computeCreditScore } from "@/lib/credit-score";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate, formatPaidAt } from "@/lib/dates";

// Stephen's loan: rounds due 14 Sep, 14 Oct, 13 Nov 2026 (final);
// rounds 1 and 2 interest paid.
const s = generateSchedule({ principal: 200000, disbursedAt: parseIsoDate("2026-08-15") });
const loan = {
  id: "loan_stephen",
  principal: "200000",
  status: "ACTIVE" as const,
  interestRatePct: 15,
  cyclesAllowed: 3,
  dueAt: s.dueAt,
  installments: s.installments.map((i, k) => ({
    id: `i${k + 1}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: i.expectedInterest,
    expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
    status: "PENDING" as const,
  })),
};
const payments = [
  { amount: "30000", installmentId: "i1", paidAt: parseIsoDate("2026-09-10"), installmentDueDate: parseIsoDate("2026-09-14") },
  { amount: "30000", installmentId: "i2", paidAt: parseIsoDate("2026-10-09"), installmentDueDate: parseIsoDate("2026-10-14") },
];

// `now` as the app passes it: Tanzania wall-clock time (nowInTz).
const wall = (iso: string) => new Date(`${iso}Z`);

function statusAt(now: Date) {
  const state = computeLoanState({ ...loan, payments });
  return deriveStatuses({ ...loan, payments: [] }, state, state.currentCycle ?? 3, loan.dueAt, now);
}

describe("due-date rules", () => {
  it("the due date itself is not overdue (pay by end of day)", () => {
    expect(statusAt(wall("2026-11-13T00:01:00")).loanStatus).toBe("ACTIVE");
    expect(statusAt(wall("2026-11-13T23:59:00")).loanStatus).toBe("ACTIVE");
  });

  it("the day after the final due date, an unpaid loan is defaulted", () => {
    expect(statusAt(wall("2026-11-14T00:01:00")).loanStatus).toBe("DEFAULTED");
  });

  it("the Lendo Score doesn't punish anyone on their due date", () => {
    const onDueDate = computeCreditScore([{ ...loan, payments }], wall("2026-11-13T12:00:00"));
    expect(onDueDate.score).toBe(100);
    expect(onDueDate.autoBlacklisted).toBe(false);
    const dayAfter = computeCreditScore([{ ...loan, payments }], wall("2026-11-14T12:00:00"));
    expect(dayAfter.score).toBeLessThan(50);
    expect(dayAfter.reasons.some((r) => r.label.includes("not settled in full by final due date"))).toBe(true);
  });
});


describe("payment dates", () => {
  it("shows a date-only payment without a made-up time", () => {
    expect(formatPaidAt(new Date("2026-10-09T00:00:00.000Z"))).toBe("09 Oct 2026");
  });
  it("keeps a real time (Tanzania clock) when one was recorded", () => {
    expect(formatPaidAt(new Date("2026-10-09T09:30:00.000Z"))).toBe("09 Oct 2026, 12:30");
  });
});
