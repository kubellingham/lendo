import { describe, it, expect } from "vitest";
import { computeCreditScore, type ScoreLoan } from "@/lib/credit-score";
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
});
