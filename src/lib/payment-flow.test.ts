import { describe, it, expect } from "vitest";
import {
  computeLoanState,
  deriveStatuses,
  type CalcInstallment,
  type CalcPayment,
} from "@/lib/loan-calc";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";

// Simulates the record-payment server action's pure decision logic for the
// verification scenarios (without a database).
function makeInstallments(): CalcInstallment[] {
  const s = generateSchedule({
    principal: 100000,
    disbursedAt: parseIsoDate("2026-06-29"),
  });
  return s.installments.map((i, idx) => ({
    id: `inst${idx + 1}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: i.expectedInterest,
    expectedPrincipalAtThisCycle: i.expectedPrincipalAtThisCycle,
    status: "PENDING" as const,
  }));
}

function applyPayment(
  installments: CalcInstallment[],
  existing: CalcPayment[],
  amount: string,
  targetId: string,
  now: Date,
  loanDueAt: Date,
) {
  const target = installments.find((i) => i.id === targetId)!;
  const state = computeLoanState({
    principal: "100000",
    status: "ACTIVE",
    installments,
    payments: [...existing, { amount, installmentId: targetId }],
  });
  const derived = deriveStatuses(
    { principal: "100000", status: "ACTIVE", installments, payments: [] },
    state,
    target.cycleNumber,
    loanDueAt,
    now,
  );
  // mutate statuses like the DB update would
  for (const inst of installments) {
    inst.status = derived.installmentStatuses[inst.id];
  }
  return derived;
}

describe("record-payment flow", () => {
  it("interest-only at day 30 → cycle 1 INTEREST_PAID, loan ACTIVE", () => {
    const installments = makeInstallments();
    const loanDueAt = parseIsoDate("2026-09-27");
    const day30 = parseIsoDate("2026-07-29");

    const r1 = applyPayment(installments, [], "15000", "inst1", day30, loanDueAt);
    expect(installments[0].status).toBe("INTEREST_PAID");
    expect(r1.loanStatus).toBe("ACTIVE");
    expect(r1.settled).toBe(false);
  });

  it("full settlement at day 60 → cycle 2 SETTLED, loan SETTLED", () => {
    const installments = makeInstallments();
    const loanDueAt = parseIsoDate("2026-09-27");
    const day30 = parseIsoDate("2026-07-29");
    const day60 = parseIsoDate("2026-08-28");

    applyPayment(installments, [], "15000", "inst1", day30, loanDueAt);
    const existing: CalcPayment[] = [{ amount: "15000", installmentId: "inst1" }];
    const r2 = applyPayment(installments, existing, "115000", "inst2", day60, loanDueAt);

    expect(installments[1].status).toBe("SETTLED");
    expect(r2.loanStatus).toBe("SETTLED");
    expect(r2.settled).toBe(true);
    // cycle 1 remains as a recorded interest roll
    expect(installments[0].status).toBe("INTEREST_PAID");
  });

  it("marks an unpaid past-due installment OVERDUE", () => {
    const installments = makeInstallments();
    const loanDueAt = parseIsoDate("2026-09-27");
    // 'Now' is after cycle 1 due date with no payment covering interest.
    const afterDay30 = parseIsoDate("2026-08-05");
    const r = applyPayment(installments, [], "5000", "inst1", afterDay30, loanDueAt);
    expect(installments[0].status).toBe("OVERDUE");
    expect(r.loanStatus).toBe("OVERDUE");
  });

  it("interest-only on the FINAL cycle → DEFAULTED even before the due date", () => {
    const installments = makeInstallments();
    const loanDueAt = parseIsoDate("2026-09-27");
    applyPayment(installments, [], "15000", "inst1", parseIsoDate("2026-07-29"), loanDueAt);
    applyPayment(
      installments,
      [{ amount: "15000", installmentId: "inst1" }],
      "15000",
      "inst2",
      parseIsoDate("2026-08-28"),
      loanDueAt,
    );
    // Final cycle: only the interest is paid, principal still fully owed, and
    // it isn't past the due date yet — the term is used up, so: DEFAULTED.
    const r3 = applyPayment(
      installments,
      [
        { amount: "15000", installmentId: "inst1" },
        { amount: "15000", installmentId: "inst2" },
      ],
      "15000",
      "inst3",
      parseIsoDate("2026-09-20"),
      loanDueAt,
    );
    expect(installments[2].status).toBe("INTEREST_PAID");
    expect(r3.loanStatus).toBe("DEFAULTED");
    expect(r3.settled).toBe(false);
  });

  it("full settlement on the final cycle → SETTLED, not defaulted", () => {
    const installments = makeInstallments();
    const loanDueAt = parseIsoDate("2026-09-27");
    const r = applyPayment(
      installments,
      [],
      "115000",
      "inst3",
      parseIsoDate("2026-09-20"),
      loanDueAt,
    );
    expect(r.settled).toBe(true);
    expect(r.loanStatus).toBe("SETTLED");
  });
});
