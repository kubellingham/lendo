"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { loanSchema, type LoanInput } from "@/lib/validation";
import { generateSchedule } from "@/lib/schedule";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { toDbString } from "@/lib/money";
import { parseIsoDate, nowInTz } from "@/lib/dates";
import { Role, type InstallmentStatus } from "@/generated/prisma/enums";
import { recomputeCustomerRisk } from "@/lib/customer-risk";
import {
  assessEligibility,
  bandMeta,
  type Eligibility,
  type ScoreReason,
} from "@/lib/credit-score";

export type LoanActionResult =
  | { ok: true; id: string; redirectTo?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** Customer is blacklisted; issuance blocked. */
      requiresOverride?: boolean;
      /** True when the acting user (ADMIN) may override the block. */
      canOverride?: boolean;
    };

function isManualBlacklist(c: { isFlagged: boolean; flagReason: string | null }) {
  return c.isFlagged && (c.flagReason ?? "").startsWith("BLACKLIST");
}

/** Fresh eligibility for a customer (recomputes the Lendo Score first). */
async function eligibilityFor(customer: {
  id: string;
  isFlagged: boolean;
  flagReason: string | null;
}): Promise<Eligibility | null> {
  const credit = await recomputeCustomerRisk(customer.id);
  if (!credit) return null;
  return assessEligibility(credit, {
    manualBlacklist: isManualBlacklist(customer),
    manualBlacklistReason: customer.flagReason,
  });
}

export type EligibilityView = {
  status: Eligibility["status"];
  blockers: string[];
  score: number;
  bandLabel: string;
  bandColor: string;
  reasons: ScoreReason[];
  /** The current user may override a BLOCKED result (administrators only). */
  canOverride: boolean;
};

/** Shown on the Issue loan form as soon as a customer is picked. */
export async function checkLoanEligibility(
  customerId: string,
): Promise<{ ok: true; eligibility: EligibilityView } | { ok: false; error: string }> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, isFlagged: true, flagReason: true },
  });
  if (!customer) return { ok: false, error: "Customer not found." };
  const e = await eligibilityFor(customer);
  if (!e) return { ok: false, error: "Customer not found." };
  const meta = bandMeta(e.credit.band);
  return {
    ok: true,
    eligibility: {
      status: e.status,
      blockers: e.blockers,
      score: e.credit.score,
      bandLabel: meta.label,
      bandColor: meta.color,
      reasons: e.credit.reasons,
      canOverride: user.role === Role.ADMIN,
    },
  };
}

export async function issueLoan(input: LoanInput): Promise<LoanActionResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = loanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: d.customerId } });
  if (!customer) return { ok: false, error: "Customer not found." };

  // Eligibility gate: low score, a loan late right now, or a blacklist.
  const eligibility = await eligibilityFor(customer);
  const blocked = eligibility?.status === "BLOCKED";
  if (blocked) {
    const canOverride = user.role === Role.ADMIN;
    if (!d.overrideBlacklist) {
      return {
        ok: false,
        requiresOverride: true,
        canOverride,
        error: canOverride
          ? "This customer is not eligible. Tick the override and give a reason to issue anyway."
          : "This customer is not eligible. Only an administrator can override and issue this loan.",
      };
    }
    if (!canOverride) {
      return {
        ok: false,
        error: "Only an administrator can override eligibility.",
      };
    }
    if (!d.overrideReason?.trim()) {
      return {
        ok: false,
        requiresOverride: true,
        canOverride: true,
        error: "An override reason is required.",
      };
    }
  }

  const disbursedAt = parseIsoDate(d.disbursedAt);
  const schedule = generateSchedule({ principal: d.principal, disbursedAt });

  const loan = await db.$transaction(async (tx) => {
    const created = await tx.loan.create({
      data: {
        customerId: customer.id,
        principal: toDbString(d.principal),
        disbursedAt: schedule.disbursedAt,
        dueAt: schedule.dueAt,
        issuedById: user.id,
        installments: {
          create: schedule.installments.map((inst) => ({
            cycleNumber: inst.cycleNumber,
            dueDate: inst.dueDate,
            expectedInterest: toDbString(inst.expectedInterest),
            expectedPrincipalAtThisCycle: toDbString(
              inst.expectedPrincipalAtThisCycle,
            ),
          })),
        },
      },
    });
    return created;
  });

  await audit({
    actorId: user.id,
    action: "loan.issue",
    entity: "Loan",
    entityId: loan.id,
    after: {
      customerId: customer.id,
      principal: toDbString(d.principal),
      disbursedAt: d.disbursedAt,
    },
  });

  if (blocked && d.overrideBlacklist) {
    await audit({
      actorId: user.id,
      action: "loan.eligibility_override",
      entity: "Loan",
      entityId: loan.id,
      after: {
        customerId: customer.id,
        reason: d.overrideReason,
        score: eligibility?.credit.score,
        blockers: eligibility?.blockers,
      },
    });
  }

  revalidatePath("/loans");
  revalidatePath(`/customers/${customer.id}`);
  return { ok: true, id: loan.id, redirectTo: `/loans/${loan.id}` };
}

export type UpdateLoanInput = {
  loanId: string;
  principal: string;
  disbursedAt: string; // yyyy-MM-dd
};

/**
 * Edit a loan's principal and/or disbursal date. Because cyclesAllowed is
 * fixed, the three installment rows are updated in place (matched by
 * cycleNumber) so existing payments stay linked. Statuses + reducing-balance
 * interest are then recomputed from the existing payments.
 */
export async function updateLoan(
  input: UpdateLoanInput,
): Promise<LoanActionResult> {
  try {
    let user;
    try {
      user = await requireRole(...WRITE_ROLES);
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    const principalStr = input.principal.trim();
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(principalStr) || Number(principalStr) <= 0) {
      return {
        ok: false,
        error: "Enter a valid principal amount greater than zero.",
        fieldErrors: { principal: ["Enter a valid amount"] },
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.disbursedAt)) {
      return {
        ok: false,
        error: "Pick a valid disbursal date.",
        fieldErrors: { disbursedAt: ["Pick a disbursal date"] },
      };
    }

    const loan = await db.loan.findUnique({
      where: { id: input.loanId },
      include: {
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: { select: { amount: true, installmentId: true } },
      },
    });
    if (!loan) return { ok: false, error: "Loan not found." };

    const disbursedAt = parseIsoDate(input.disbursedAt);
    const schedule = generateSchedule({
      principal: principalStr,
      disbursedAt,
      cyclesAllowed: loan.cyclesAllowed,
      cycleDays: loan.cycleDays,
      interestRatePct: loan.interestRatePct,
    });

    // Map new schedule rows to existing installment ids by cycle number.
    const byCycle = new Map(
      loan.installments.map((i) => [i.cycleNumber, i]),
    );

    const state = computeLoanState({
      principal: principalStr,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments.map((i) => {
        const sched = schedule.installments.find(
          (s) => s.cycleNumber === i.cycleNumber,
        );
        return {
          ...i,
          dueDate: sched?.dueDate ?? i.dueDate,
          expectedInterest: sched?.expectedInterest ?? i.expectedInterest,
        };
      }),
      payments: loan.payments,
    });
    const now = nowInTz();
    const { installmentStatuses, loanStatus } = deriveStatuses(
      {
        principal: principalStr,
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        installments: loan.installments,
        payments: [],
      },
      state,
      1,
      schedule.dueAt,
      now,
    );

    await db.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          principal: toDbString(principalStr),
          disbursedAt: schedule.disbursedAt,
          dueAt: schedule.dueAt,
          status: loanStatus,
        },
      });
      for (const sched of schedule.installments) {
        const existing = byCycle.get(sched.cycleNumber);
        if (!existing) continue;
        await tx.installment.update({
          where: { id: existing.id },
          data: {
            dueDate: sched.dueDate,
            expectedInterest: toDbString(
              state.perInstallmentInterestOwed[existing.id] ??
                sched.expectedInterest,
            ),
            expectedPrincipalAtThisCycle: toDbString(
              sched.expectedPrincipalAtThisCycle,
            ),
            status: installmentStatuses[existing.id] as InstallmentStatus,
          },
        });
      }
    });

    await audit({
      actorId: user.id,
      action: "loan.update",
      entity: "Loan",
      entityId: loan.id,
      before: {
        principal: loan.principal.toString(),
        disbursedAt: loan.disbursedAt.toISOString().slice(0, 10),
      },
      after: { principal: principalStr, disbursedAt: input.disbursedAt },
    });

    revalidatePath(`/loans/${loan.id}`);
    revalidatePath("/loans");
    revalidatePath(`/customers/${loan.customerId}`);
    revalidatePath("/dashboard");
    return { ok: true, id: loan.id, redirectTo: `/loans/${loan.id}` };
  } catch (err) {
    console.error("[updateLoan] unhandled error", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not update loan: ${err.message}`
          : "Could not update loan (unknown error).",
    };
  }
}

/**
 * Delete a loan and everything attached to it (installments + payments cascade
 * at the DB level). ADMIN only, since it destroys financial records.
 */
export async function deleteLoan(
  loanId: string,
): Promise<LoanActionResult> {
  try {
    let user;
    try {
      user = await requireRole(Role.ADMIN);
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    const loan = await db.loan.findUnique({
      where: { id: loanId },
      select: { id: true, customerId: true, principal: true },
    });
    if (!loan) return { ok: false, error: "Loan not found." };

    await db.loan.delete({ where: { id: loanId } });

    await audit({
      actorId: user.id,
      action: "loan.delete",
      entity: "Loan",
      entityId: loanId,
      before: {
        customerId: loan.customerId,
        principal: loan.principal.toString(),
      },
    });

    revalidatePath("/loans");
    revalidatePath(`/customers/${loan.customerId}`);
    revalidatePath("/dashboard");
    return { ok: true, id: loanId, redirectTo: `/customers/${loan.customerId}` };
  } catch (err) {
    console.error("[deleteLoan] unhandled error", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not delete loan: ${err.message}`
          : "Could not delete loan (unknown error).",
    };
  }
}
