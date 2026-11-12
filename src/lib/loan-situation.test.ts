import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import {
  amountLines,
  bestTemplateFor,
  calendarDays,
  dueWhenText,
  loanSituation,
  minimumReason,
  roundsText,
  situationSummary,
  templateMismatch,
} from "@/lib/loan-situation";

// Stephen's loan from the screenshot: TSh 200,000, rounds due 14 Sep, 14 Oct,
// 13 Nov 2026; rounds 1 and 2 interest paid (TSh 30,000 each).
function stephen(payments: { amount: string; installmentId: string }[] = [
  { amount: "30000", installmentId: "i1" },
  { amount: "30000", installmentId: "i2" },
]) {
  const s = generateSchedule({ principal: 200000, disbursedAt: parseIsoDate("2026-08-15") });
  return {
    principal: "200000",
    status: "ACTIVE" as const,
    interestRatePct: 15,
    cyclesAllowed: 3,
    dueAt: s.dueAt,
    installments: s.installments.map((i, idx) => ({
      id: `i${idx + 1}`,
      cycleNumber: i.cycleNumber,
      dueDate: i.dueDate,
      expectedInterest: i.expectedInterest,
      expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
      status: "PENDING" as const,
    })),
    payments,
  };
}

// 10:45 in Dar es Salaam on 12 Nov 2026 (07:45 UTC) — when the screenshot was taken.
const NOW = new Date("2026-11-12T07:45:00Z");

describe("loanSituation — Stephen's loan", () => {
  const s = loanSituation(stephen(), NOW);

  it("knows it's the final round, due tomorrow, full balance", () => {
    expect(s.round).toBe(3);
    expect(s.isFinalRound).toBe(true);
    expect(s.daysUntilDue).toBe(1);
    expect(dueWhenText(s.daysUntilDue!)).toBe("tomorrow");
    expect(s.minimumDue.toString()).toBe("230000");
    expect(s.toClear.toString()).toBe("230000");
  });

  it("says so in plain words, and picks the right template", () => {
    expect(situationSummary(s)).toBe(
      "Round 3 of 3: due tomorrow, 13 Nov 2026 — TSh 230,000 must be paid in full (final round).",
    );
    expect(amountLines(s)).toContain("final round — the full balance must be paid");
    expect(bestTemplateFor(s)).toBe("reminder_3d");
    expect(templateMismatch("reminder_3d", s)).toBeNull();
    expect(templateMismatch("due_today", s)).toContain("due tomorrow, not today");
    expect(templateMismatch("overdue", s)).toContain("isn't overdue yet");
  });
});

describe("loanSituation — timing matrix", () => {
  const at = (iso: string) => loanSituation(stephen(), new Date(iso));

  it("counts Tanzania calendar days, not hours", () => {
    // 01:30 on 13 Nov in Dar (22:30 UTC on the 12th) → due today
    expect(at("2026-11-12T22:30:00Z").daysUntilDue).toBe(0);
    // 23:59 on 12 Nov in Dar → still tomorrow
    expect(at("2026-11-12T20:59:00Z").daysUntilDue).toBe(1);
    expect(at("2026-11-06T09:00:00Z").daysUntilDue).toBe(7);
    expect(at("2026-11-14T09:00:00Z").daysUntilDue).toBe(-1);
    expect(at("2026-11-23T09:00:00Z").daysUntilDue).toBe(-10);
  });

  it("chooses the template that fits each day", () => {
    expect(bestTemplateFor(at("2026-11-06T09:00:00Z"))).toBe("reminder_7d"); // 7 days
    expect(bestTemplateFor(at("2026-11-10T09:00:00Z"))).toBe("reminder_3d"); // 3 days
    expect(bestTemplateFor(at("2026-11-13T09:00:00Z"))).toBe("due_today");
    expect(bestTemplateFor(at("2026-11-14T09:00:00Z"))).toBe("overdue");
    expect(templateMismatch("reminder_7d", at("2026-11-14T09:00:00Z"))).toContain("overdue");
  });

  it("asks only for the round's interest before the final round", () => {
    const early = loanSituation(stephen([]), new Date("2026-09-10T09:00:00Z"));
    expect(early.round).toBe(1);
    expect(early.isFinalRound).toBe(false);
    expect(early.minimumDue.toString()).toBe("30000");
    expect(early.toClear.toString()).toBe("230000");
    expect(amountLines(early)).toContain("Minimum to pay: *TSh 30,000* (interest for round 1 of 3)");
  });

  it("handles a fully repaid loan", () => {
    const done = loanSituation(stephen([{ amount: "230000", installmentId: "i1" }]), NOW);
    expect(done.settled).toBe(true);
    expect(bestTemplateFor(done)).toBe("loan_settled");
    expect(templateMismatch("reminder_3d", done)).toContain("fully repaid");
  });

  it("calendarDays ignores the time of day", () => {
    expect(calendarDays(new Date("2026-11-12T21:05:00Z"), parseIsoDate("2026-11-13"))).toBe(0);
  });
});


/** A 1,000,000 loan (150,000 interest a round) with optional paid rounds. */
function missed(disbursed: string, paidRounds: number[] = []) {
  const s = generateSchedule({ principal: 1000000, disbursedAt: parseIsoDate(disbursed) });
  const installments = s.installments.map((i) => ({
    id: `r${i.cycleNumber}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: new Decimal(i.expectedInterest),
    expectedPrincipalAtThisCycle: new Decimal(i.expectedPrincipalAtThisCycle),
    status: "PENDING" as const,
  }));
  return {
    principal: new Decimal(1000000),
    status: "ACTIVE" as const,
    interestRatePct: 15,
    cyclesAllowed: 3,
    dueAt: s.dueAt,
    installments,
    payments: paidRounds.map((r) => ({ amount: new Decimal(150000), installmentId: `r${r}` })),
  };
}

describe("more than one round behind", () => {
  const today = new Date("2026-11-12T09:00:00Z");
  it("counts every missed round, not just the first (Ansbert: rounds due 25 Sep and 25 Oct)", () => {
    const s = loanSituation(missed("2026-08-26"), today);
    expect(s.overdueRounds).toEqual([1, 2]);
    expect(Number(s.amountOverdue)).toBe(300000);
    expect(Number(s.minimumDue)).toBe(300000);
    expect(s.fullBalanceDue).toBe(false);
    expect(minimumReason(s)).toBe("unpaid interest for rounds 1–2 of 3");
    expect(amountLines(s)).toContain("*TSh 300,000* (unpaid interest for rounds 1–2 of 3)");
  });
  it("one missed round stays as before", () => {
    const s = loanSituation(missed("2026-08-26", [1]), today);
    expect(s.overdueRounds).toEqual([2]);
    expect(Number(s.minimumDue)).toBe(150000);
    expect(minimumReason(s)).toBe("interest for round 2 of 3");
  });
  it("after the final round has passed, the whole balance is overdue", () => {
    const s = loanSituation(missed("2026-07-01"), today); // rounds due 31 Jul, 30 Aug, 29 Sep
    expect(s.overdueRounds).toEqual([1, 2, 3]);
    expect(s.fullBalanceDue).toBe(true);
    expect(Number(s.minimumDue)).toBe(Number(s.toClear));
    expect(amountLines(s)).toContain("the full balance must be paid");
  });
  it("nothing overdue on a loan that's up to date", () => {
    const s = loanSituation(missed("2026-10-20"), today);
    expect(s.overdueRounds).toEqual([]);
    expect(Number(s.amountOverdue)).toBe(0);
    expect(Number(s.minimumDue)).toBe(150000);
  });
  it("roundsText", () => {
    expect(roundsText([2])).toBe("round 2");
    expect(roundsText([1, 2, 3])).toBe("rounds 1–3");
    expect(roundsText([1, 3])).toBe("rounds 1 and 3");
  });
});
