import { computeLoanState, deriveStatuses, type CalcInstallment } from "@/lib/loan-calc";
import type { LoanStatus, RiskBand } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Lendo Score — a rules-based 0–100 risk meter per customer. All the knobs live
// here so the protocol can be tuned in one place. Higher = safer.
// ---------------------------------------------------------------------------

/** Day-late tiers (worst active loan drives the penalty). */
const LATE_TIERS: { maxDays: number; penalty: number; label: string }[] = [
  { maxDays: 0, penalty: 0, label: "Current" },
  { maxDays: 7, penalty: -10, label: "1–7 days late" },
  { maxDays: 30, penalty: -25, label: "8–30 days late" },
  { maxDays: 60, penalty: -45, label: "31–60 days late" },
  { maxDays: 90, penalty: -65, label: "61–90 days late" },
  { maxDays: Infinity, penalty: -85, label: "90+ days late / defaulted" },
];

const SETTLED_BONUS = 5; // per fully repaid loan
const SETTLED_BONUS_CAP = 20;
const DEFAULT_PENALTY = -20; // per written-off loan (permanent black mark)
const ONTIME_GOOD_RATE = 0.9;
const ONTIME_GOOD_BONUS = 5;
const ONTIME_BAD_RATE = 0.6;
const ONTIME_BAD_PENALTY = -10;
const MIN_PAYMENTS_FOR_RATE = 3;

/** Band thresholds (score ≥ min). */
const BANDS: { band: RiskBand; min: number; label: string; color: string }[] = [
  { band: "EXCELLENT", min: 85, label: "Excellent", color: "#16a34a" },
  { band: "GOOD", min: 70, label: "Good", color: "#65a30d" },
  { band: "WATCH", min: 50, label: "Watch", color: "#d97706" },
  { band: "HIGH_RISK", min: 30, label: "High risk", color: "#ea580c" },
  { band: "CRITICAL", min: 0, label: "Critical", color: "#dc2626" },
];

export function bandMeta(band: RiskBand) {
  return BANDS.find((b) => b.band === band) ?? BANDS[BANDS.length - 1];
}

const DAY = 24 * 60 * 60 * 1000;

export type ScoreLoan = {
  principal: string | number;
  status: LoanStatus;
  interestRatePct?: number;
  cyclesAllowed: number;
  dueAt: Date;
  installments: CalcInstallment[];
  payments: {
    amount: string | number;
    installmentId: string | null;
    paidAt: Date;
    installmentDueDate: Date | null;
  }[];
};

export type CreditScore = {
  score: number;
  band: RiskBand;
  worstDaysLate: number;
  autoBlacklisted: boolean;
  reasons: { label: string; delta: number }[];
};

function tierForDays(days: number) {
  return LATE_TIERS.find((t) => days <= t.maxDays) ?? LATE_TIERS[LATE_TIERS.length - 1];
}

function bandForScore(score: number): RiskBand {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).band;
}

export function computeCreditScore(loans: ScoreLoan[], now: Date): CreditScore {
  let score = 100;
  const reasons: { label: string; delta: number }[] = [];

  let worstDaysLate = 0;
  let worstPenalty = 0;
  let worstLabel = "";
  let anyDefaulted = false;
  let settledCount = 0;
  let writeoffCount = 0;
  let onTime = 0;
  let late = 0;

  for (const loan of loans) {
    const state = computeLoanState({
      principal: String(loan.principal),
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: String(p.amount),
        installmentId: p.installmentId,
      })),
    });
    const { loanStatus, installmentStatuses } = deriveStatuses(
      {
        principal: String(loan.principal),
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        cyclesAllowed: loan.cyclesAllowed,
        installments: loan.installments,
        payments: [],
      },
      state,
      state.currentCycle ?? loan.cyclesAllowed,
      loan.dueAt,
      now,
    );

    if (loanStatus === "SETTLED") settledCount++;
    if (loanStatus === "WRITTEN_OFF") writeoffCount++;

    // Current delinquency of this loan.
    let daysLate = 0;
    let penalty = 0;
    let label = "";
    if (loanStatus === "DEFAULTED") {
      anyDefaulted = true;
      daysLate = Math.max(
        91,
        Math.floor((now.getTime() - loan.dueAt.getTime()) / DAY),
      );
      const worst = LATE_TIERS[LATE_TIERS.length - 1];
      penalty = worst.penalty;
      label = worst.label;
    } else if (loanStatus === "OVERDUE") {
      const overdueInst = loan.installments
        .filter((i) => installmentStatuses[i.id] === "OVERDUE")
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      const ref = overdueInst?.dueDate ?? loan.dueAt;
      daysLate = Math.max(1, Math.floor((now.getTime() - ref.getTime()) / DAY));
      const tier = tierForDays(daysLate);
      penalty = tier.penalty;
      label = tier.label;
    }
    if (daysLate > worstDaysLate) worstDaysLate = daysLate;
    if (penalty < worstPenalty) {
      worstPenalty = penalty;
      worstLabel = label;
    }

    // Payment punctuality.
    for (const p of loan.payments) {
      if (!p.installmentDueDate) continue;
      const d = Math.floor(
        (Date.UTC(
          p.paidAt.getUTCFullYear(),
          p.paidAt.getUTCMonth(),
          p.paidAt.getUTCDate(),
        ) -
          Date.UTC(
            p.installmentDueDate.getUTCFullYear(),
            p.installmentDueDate.getUTCMonth(),
            p.installmentDueDate.getUTCDate(),
          )) /
          DAY,
      );
      if (d > 0) late++;
      else onTime++;
    }
  }

  // Apply worst current lateness.
  if (worstPenalty < 0) {
    score += worstPenalty;
    reasons.push({ label: worstLabel, delta: worstPenalty });
  }

  // History.
  if (settledCount > 0) {
    const bonus = Math.min(settledCount * SETTLED_BONUS, SETTLED_BONUS_CAP);
    score += bonus;
    reasons.push({ label: `${settledCount} loan(s) fully repaid`, delta: bonus });
  }
  if (writeoffCount > 0) {
    const pen = writeoffCount * DEFAULT_PENALTY;
    score += pen;
    reasons.push({ label: `${writeoffCount} written-off loan(s)`, delta: pen });
  }

  const totalPmts = onTime + late;
  if (totalPmts >= MIN_PAYMENTS_FOR_RATE) {
    const rate = onTime / totalPmts;
    if (rate >= ONTIME_GOOD_RATE) {
      score += ONTIME_GOOD_BONUS;
      reasons.push({
        label: `${Math.round(rate * 100)}% of payments on time`,
        delta: ONTIME_GOOD_BONUS,
      });
    } else if (rate < ONTIME_BAD_RATE) {
      score += ONTIME_BAD_PENALTY;
      reasons.push({
        label: `Only ${Math.round(rate * 100)}% of payments on time`,
        delta: ONTIME_BAD_PENALTY,
      });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    band: bandForScore(score),
    worstDaysLate,
    autoBlacklisted: anyDefaulted || worstDaysLate > 90,
    reasons,
  };
}
