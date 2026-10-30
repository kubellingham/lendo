import { describe, it, expect } from "vitest";
import {
  computeCreditScore,
  assessEligibility,
  type ScoreLoan,
} from "@/lib/credit-score";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import type { LoanStatus } from "@/generated/prisma/enums";

function loan(
  disbursed: string,
  status: LoanStatus,
  payments: ScoreLoan["payments"] = [],
): ScoreLoan {
  const s = generateSchedule({
    principal: 1000000,
    disbursedAt: parseIsoDate(disbursed),
  });
  return {
    principal: "1000000",
    status,
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

const NOW = parseIsoDate("2026-03-01"); // day ~59 after 2026-01-01

describe("computeCreditScore", () => {
  it("clean, current borrower scores near the top", () => {
    // Disbursed 1 Jan; cycle 1 (due 31 Jan) interest paid on time.
    const l = loan("2026-01-01", "ACTIVE", [
      {
        amount: "150000",
        installmentId: "i1",
        paidAt: parseIsoDate("2026-01-30"),
        installmentDueDate: parseIsoDate("2026-01-31"),
      },
    ]);
    const r = computeCreditScore([l], NOW);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.band).toBe("EXCELLENT");
    expect(r.autoBlacklisted).toBe(false);
  });

  it("a defaulted loan auto-blacklists and tanks the score", () => {
    // Disbursed far in the past, nothing paid → defaulted, 90+ late.
    const l = loan("2025-10-01", "DEFAULTED", []);
    const r = computeCreditScore([l], NOW);
    expect(r.autoBlacklisted).toBe(true);
    expect(r.score).toBeLessThan(30);
    expect(r.band).toBe("CRITICAL");
  });

  it("settled history adds a bonus", () => {
    // Fully paid off (principal + cycle-1 interest) → computes as SETTLED.
    const settled = loan("2026-01-01", "ACTIVE", [
      {
        amount: "1150000",
        installmentId: "i1",
        paidAt: parseIsoDate("2026-01-20"),
        installmentDueDate: parseIsoDate("2026-01-31"),
      },
    ]);
    const r = computeCreditScore([settled], NOW);
    expect(r.reasons.some((x) => x.delta > 0)).toBe(true);
    expect(r.score).toBe(100); // clamped
  });

  it("worst loan drives the band across multiple loans", () => {
    const good = loan("2026-02-01", "ACTIVE", []);
    const bad = loan("2025-10-01", "DEFAULTED", []);
    const r = computeCreditScore([good, bad], NOW);
    expect(r.autoBlacklisted).toBe(true);
    expect(r.band).toBe("CRITICAL");
  });

  // Disbursed 1 Jan 2026 → cycles due 31 Jan, 2 Mar, 1 Apr (final).
  function lateThenPaid(): ScoreLoan {
    return {
      ...loan("2026-01-01", "SETTLED", [
        { amount: "150000", installmentId: "i1", paidAt: parseIsoDate("2026-01-30"), installmentDueDate: parseIsoDate("2026-01-31") },
        { amount: "150000", installmentId: "i2", paidAt: parseIsoDate("2026-03-01"), installmentDueDate: parseIsoDate("2026-03-02") },
        // Final cycle settled 40 days late.
        { amount: "1150000", installmentId: "i3", paidAt: parseIsoDate("2026-05-11"), installmentDueDate: parseIsoDate("2026-04-01") },
      ]),
      id: "loan_ansbert",
    };
  }

  it("paying late does NOT reset the score to 100 once the debt is cleared", () => {
    const r = computeCreditScore([lateThenPaid()], parseIsoDate("2026-06-01"));
    // −15 (settled 40 days late) −20 (missed final settlement); no repaid bonus.
    expect(r.score).toBe(65);
    expect(r.band).toBe("WATCH");
    expect(r.worstDaysLate).toBe(0); // nothing late right now
    const labels = r.reasons.map((x) => x.label).join(" | ");
    expect(labels).toContain("LND-NSBERT · cycle 3 settled 40 day(s) late");
    expect(labels).toContain("not settled in full by final due date");
    expect(labels).not.toContain("repaid on time");
  });

  it("history penalties count half after 6 months", () => {
    const r = computeCreditScore([lateThenPaid()], parseIsoDate("2027-01-01"));
    expect(r.score).toBe(100 - 8 - 10);
    expect(r.reasons.every((x) => x.delta >= 0 || x.faded)).toBe(true);
  });

  it("a loan repaid on time keeps a perfect score and earns the bonus", () => {
    const l = loan("2026-01-01", "SETTLED", [
      { amount: "150000", installmentId: "i1", paidAt: parseIsoDate("2026-01-29"), installmentDueDate: parseIsoDate("2026-01-31") },
      { amount: "150000", installmentId: "i2", paidAt: parseIsoDate("2026-03-01"), installmentDueDate: parseIsoDate("2026-03-02") },
      { amount: "1150000", installmentId: "i3", paidAt: parseIsoDate("2026-03-30"), installmentDueDate: parseIsoDate("2026-04-01") },
    ]);
    const r = computeCreditScore([l], parseIsoDate("2026-06-01"));
    expect(r.score).toBe(100);
    expect(r.reasons.some((x) => x.label.includes("repaid on time"))).toBe(true);
    expect(r.reasons.every((x) => x.delta >= 0)).toBe(true);
  });

  it("small slips add up across cycles", () => {
    const l = loan("2026-01-01", "ACTIVE", [
      { amount: "150000", installmentId: "i1", paidAt: parseIsoDate("2026-02-05"), installmentDueDate: parseIsoDate("2026-01-31") }, // 5 late → −3
      { amount: "150000", installmentId: "i2", paidAt: parseIsoDate("2026-03-20"), installmentDueDate: parseIsoDate("2026-03-02") }, // 18 late → −8
    ]);
    const r = computeCreditScore([l], parseIsoDate("2026-03-25"));
    expect(r.score).toBe(89);
  });
});

describe("assessEligibility", () => {
  it("Watch band can proceed with a warning", () => {
    const r = computeCreditScore([lateThenPaidFixture()], parseIsoDate("2026-06-01"));
    const e = assessEligibility(r);
    expect(e.status).toBe("WARNING");
    expect(e.blockers).toHaveLength(0);
  });

  it("a loan late right now blocks a new loan", () => {
    const l = loan("2026-01-01", "ACTIVE", []); // cycle 1 unpaid, due 31 Jan
    const e = assessEligibility(computeCreditScore([l], parseIsoDate("2026-02-10")));
    expect(e.status).toBe("BLOCKED");
    expect(e.blockers[0]).toContain("late right now");
  });

  it("a score below 50 blocks, and a manual blacklist blocks", () => {
    const low = assessEligibility({ score: 45, band: "HIGH_RISK", worstDaysLate: 0, autoBlacklisted: false, reasons: [] });
    expect(low.status).toBe("BLOCKED");
    expect(low.blockers[0]).toContain("below the 50");
    const bl = assessEligibility(
      { score: 100, band: "EXCELLENT", worstDaysLate: 0, autoBlacklisted: false, reasons: [] },
      { manualBlacklist: true, manualBlacklistReason: "BLACKLIST: fraud" },
    );
    expect(bl.blockers).toEqual(["Blacklisted by staff: fraud"]);
  });
});

function lateThenPaidFixture(): ScoreLoan {
  const s = generateSchedule({ principal: 1000000, disbursedAt: parseIsoDate("2026-01-01") });
  return {
    id: "loan_ansbert",
    principal: "1000000",
    status: "SETTLED",
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
    payments: [
      { amount: "150000", installmentId: "i1", paidAt: parseIsoDate("2026-01-30"), installmentDueDate: parseIsoDate("2026-01-31") },
      { amount: "150000", installmentId: "i2", paidAt: parseIsoDate("2026-03-01"), installmentDueDate: parseIsoDate("2026-03-02") },
      { amount: "1150000", installmentId: "i3", paidAt: parseIsoDate("2026-05-11"), installmentDueDate: parseIsoDate("2026-04-01") },
    ],
  };
}
