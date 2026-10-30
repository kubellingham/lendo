import { computeLoanState, deriveStatuses, type CalcInstallment } from "@/lib/loan-calc";
import type { LoanStatus, RiskBand } from "@/generated/prisma/enums";
import { formatDate, toBusinessDate } from "@/lib/dates";

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

/**
 * Penalty for each cycle that was paid late — it stays on the record after
 * the borrower catches up, so paying late and then paying never resets to 100.
 */
const HISTORY_TIERS: { maxDays: number; penalty: number }[] = [
  { maxDays: 7, penalty: -3 },
  { maxDays: 30, penalty: -8 },
  { maxDays: 60, penalty: -15 },
  { maxDays: 90, penalty: -25 },
  { maxDays: Infinity, penalty: -35 },
];
/** Final cycle must be settled in full; rolling past it breaks the 3-cycle rule. */
const MISSED_FINAL_SETTLEMENT = -20;
/** History penalties count half once they are older than this. */
const FADE_AFTER_DAYS = 182; // ~6 months

const SETTLED_BONUS = 5; // per loan repaid with no payment more than 7 days late
const SETTLED_BONUS_CAP = 20;
const CLEAN_REPAY_MAX_DAYS_LATE = 7;
const DEFAULT_PENALTY = -20; // per written-off loan (permanent black mark)
const ONTIME_GOOD_RATE = 0.9;
const ONTIME_GOOD_BONUS = 5;
const MIN_CYCLES_FOR_RATE = 3;

/** Below this score a customer needs an admin override for a new loan. */
export const ELIGIBILITY_MIN_SCORE = 50;

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
  /** Loan id — used for the "LND-XXXXXX" reference in reasons. */
  id?: string;
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

export type ScoreReason = {
  label: string;
  delta: number;
  /** True for penalties older than 6 months (counted at half). */
  faded?: boolean;
};

export type CreditScore = {
  score: number;
  band: RiskBand;
  /** Days late on the worst loan that is late *right now* (0 = none). */
  worstDaysLate: number;
  autoBlacklisted: boolean;
  reasons: ScoreReason[];
};

function tierForDays(days: number) {
  return LATE_TIERS.find((t) => days <= t.maxDays) ?? LATE_TIERS[LATE_TIERS.length - 1];
}

function historyPenalty(days: number): number {
  return (
    HISTORY_TIERS.find((t) => days <= t.maxDays) ??
    HISTORY_TIERS[HISTORY_TIERS.length - 1]
  ).penalty;
}

function bandForScore(score: number): RiskBand {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).band;
}

function refOf(loan: ScoreLoan, idx: number): string {
  return loan.id ? "LND-" + loan.id.slice(-6).toUpperCase() : `Loan ${idx + 1}`;
}

/** Whole calendar days from a due date to an instant (business-day based). */
function daysAfter(dueDate: Date, at: Date): number {
  return Math.round(
    (toBusinessDate(at).getTime() - toBusinessDate(dueDate).getTime()) / DAY,
  );
}

/** Older than 6 months → half penalty (rounded away from zero). */
function fade(penalty: number, at: Date, now: Date): { delta: number; faded: boolean } {
  if (now.getTime() - at.getTime() > FADE_AFTER_DAYS * DAY) {
    return { delta: -Math.round(Math.abs(penalty) / 2), faded: true };
  }
  return { delta: penalty, faded: false };
}

type CycleOutcome = {
  cycleNumber: number;
  dueDate: Date;
  isFinal: boolean;
  /** When the cycle's obligation was met (null = not met yet). */
  coveredAt: Date | null;
};

/**
 * Replay a loan's payments in date order to find *when* each scheduled cycle
 * was met: a normal cycle once its interest is covered, the final cycle only
 * once the loan is settled in full (the 3-cycle rule).
 */
function cycleOutcomes(loan: ScoreLoan): CycleOutcome[] {
  const scheduled = [...loan.installments]
    .filter((i) => i.cycleNumber <= loan.cyclesAllowed)
    .sort((a, b) => a.cycleNumber - b.cycleNumber);
  const payments = [...loan.payments].sort(
    (a, b) => a.paidAt.getTime() - b.paidAt.getTime(),
  );
  const covered = new Map<string, Date>();

  for (let k = 1; k <= payments.length; k++) {
    const at = payments[k - 1].paidAt;
    const state = computeLoanState({
      principal: String(loan.principal),
      status: "ACTIVE",
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: payments.slice(0, k).map((p) => ({
        amount: String(p.amount),
        installmentId: p.installmentId,
      })),
    });
    for (const inst of scheduled) {
      if (covered.has(inst.id)) continue;
      if (state.isSettled) {
        covered.set(inst.id, at);
        continue;
      }
      if (inst.cycleNumber >= loan.cyclesAllowed) continue; // needs settlement
      const owed = state.perInstallmentInterestOwed[inst.id];
      const paid = state.perInstallmentPaid[inst.id];
      if (owed && owed.gt(0) && paid && paid.gte(owed)) covered.set(inst.id, at);
    }
  }

  return scheduled.map((i) => ({
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    isFinal: i.cycleNumber >= loan.cyclesAllowed,
    coveredAt: covered.get(i.id) ?? null,
  }));
}

export function computeCreditScore(loans: ScoreLoan[], now: Date): CreditScore {
  let score = 100;
  const reasons: ScoreReason[] = [];

  let worstDaysLate = 0;
  let worstPenalty = 0;
  let worstLabel = "";
  let anyDefaulted = false;
  let cleanSettled = 0;
  let writeoffCount = 0;
  let onTimeCycles = 0;
  let lateCycles = 0;

  loans.forEach((loan, idx) => {
    const ref = refOf(loan, idx);
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

    if (loanStatus === "WRITTEN_OFF") writeoffCount++;

    // 1) Lateness right now (the worst open loan drives this).
    let daysLate = 0;
    let penalty = 0;
    let label = "";
    if (loanStatus === "DEFAULTED") {
      anyDefaulted = true;
      daysLate = Math.max(91, Math.floor((now.getTime() - loan.dueAt.getTime()) / DAY));
      penalty = LATE_TIERS[LATE_TIERS.length - 1].penalty;
      label = `${ref} defaulted — ${daysLate} days past final due date`;
    } else if (loanStatus === "OVERDUE") {
      const overdueInst = loan.installments
        .filter((i) => installmentStatuses[i.id] === "OVERDUE")
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      const refDate = overdueInst?.dueDate ?? loan.dueAt;
      daysLate = Math.max(1, Math.floor((now.getTime() - refDate.getTime()) / DAY));
      penalty = tierForDays(daysLate).penalty;
      label = `${ref} is ${daysLate} day(s) late right now`;
    }
    if (daysLate > worstDaysLate) worstDaysLate = daysLate;
    if (penalty < worstPenalty) {
      worstPenalty = penalty;
      worstLabel = label;
    }

    // 2) Track record: every cycle that was met late stays on the record.
    let worstPaidLate = 0;
    for (const c of cycleOutcomes(loan)) {
      if (c.coveredAt) {
        const late = daysAfter(c.dueDate, c.coveredAt);
        if (late > 0) {
          lateCycles++;
          worstPaidLate = Math.max(worstPaidLate, late);
          const f = fade(historyPenalty(late), c.coveredAt, now);
          reasons.push({
            label: `${ref} · cycle ${c.cycleNumber} ${c.isFinal ? "settled" : "paid"} ${late} day(s) late (${formatDate(c.coveredAt, "MMM yyyy")})`,
            ...f,
          });
        } else {
          onTimeCycles++;
        }
      }
      // Final cycle not settled in full by its due date — breaks the 3-cycle
      // rule, even if the borrower pays later.
      if (c.isFinal) {
        const missed = c.coveredAt
          ? daysAfter(c.dueDate, c.coveredAt) > 0
          : now.getTime() > c.dueDate.getTime();
        if (missed) {
          const f = c.coveredAt
            ? fade(MISSED_FINAL_SETTLEMENT, c.coveredAt, now)
            : { delta: MISSED_FINAL_SETTLEMENT, faded: false };
          reasons.push({
            label: `${ref} · not settled in full by final due date (${formatDate(c.dueDate)})`,
            ...f,
          });
        }
      }
    }

    if (loanStatus === "SETTLED" && worstPaidLate <= CLEAN_REPAY_MAX_DAYS_LATE) {
      cleanSettled++;
    }
  });

  // Current lateness goes first — it's the most urgent reason.
  if (worstPenalty < 0) reasons.unshift({ label: worstLabel, delta: worstPenalty });

  if (writeoffCount > 0) {
    reasons.push({
      label: `${writeoffCount} written-off loan(s)`,
      delta: writeoffCount * DEFAULT_PENALTY,
    });
  }
  if (cleanSettled > 0) {
    reasons.push({
      label: `${cleanSettled} loan(s) repaid on time`,
      delta: Math.min(cleanSettled * SETTLED_BONUS, SETTLED_BONUS_CAP),
    });
  }
  const totalCycles = onTimeCycles + lateCycles;
  if (totalCycles >= MIN_CYCLES_FOR_RATE && onTimeCycles / totalCycles >= ONTIME_GOOD_RATE) {
    reasons.push({
      label: `${Math.round((onTimeCycles / totalCycles) * 100)}% of payments on time`,
      delta: ONTIME_GOOD_BONUS,
    });
  }

  for (const r of reasons) score += r.delta;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    band: bandForScore(score),
    worstDaysLate,
    autoBlacklisted: anyDefaulted || worstDaysLate > 90,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Eligibility for a new loan
// ---------------------------------------------------------------------------

export type Eligibility = {
  /** ELIGIBLE: go ahead · WARNING: allowed, but look first · BLOCKED: admin override needed */
  status: "ELIGIBLE" | "WARNING" | "BLOCKED";
  /** Plain-language reasons the customer is blocked / flagged. */
  blockers: string[];
  credit: CreditScore;
};

export function assessEligibility(
  credit: CreditScore,
  opts: { manualBlacklist?: boolean; manualBlacklistReason?: string | null } = {},
): Eligibility {
  const blockers: string[] = [];
  if (opts.manualBlacklist) {
    blockers.push(
      `Blacklisted by staff${opts.manualBlacklistReason ? `: ${opts.manualBlacklistReason.replace(/^BLACKLIST:?\s*/, "")}` : ""}`,
    );
  }
  if (credit.worstDaysLate > 0) {
    blockers.push(`Has a loan that is ${credit.worstDaysLate} day(s) late right now`);
  }
  if (credit.score < ELIGIBILITY_MIN_SCORE) {
    blockers.push(
      `Lendo Score is ${credit.score} — below the ${ELIGIBILITY_MIN_SCORE} needed for a new loan`,
    );
  }
  const status = blockers.length
    ? "BLOCKED"
    : credit.band === "WATCH"
      ? "WARNING"
      : "ELIGIBLE";
  return { status, blockers, credit };
}
