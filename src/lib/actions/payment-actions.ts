"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { paymentSchema, type PaymentInput } from "@/lib/validation";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { ensureLoanCycles } from "@/lib/loan-maintenance";
import { toDbString } from "@/lib/money";
import { parseIsoDate, nowInTz } from "@/lib/dates";
import { InstallmentStatus } from "@/generated/prisma/enums";

export type PaymentResult =
  | { ok: true; loanId: string; settled: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  // Make sure any past-term cycles exist (and interest is current) before we
  // resolve the target cycle for this payment.
  await ensureLoanCycles(d.loanId);

  const loan = await db.loan.findUnique({
    where: { id: d.loanId },
    include: {
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: { select: { amount: true, installmentId: true } },
    },
  });
  if (!loan) return { ok: false, error: "Loan not found." };
  if (loan.status === "SETTLED" || loan.status === "WRITTEN_OFF") {
    return { ok: false, error: "This loan is already closed." };
  }

  // Resolve the target installment: explicit, else the current cycle, else last.
  const explicit = d.installmentId
    ? loan.installments.find((i) => i.id === d.installmentId)
    : undefined;
  const current =
    loan.installments.find(
      (i) =>
        i.status !== InstallmentStatus.SETTLED &&
        i.status !== InstallmentStatus.INTEREST_PAID,
    ) ?? loan.installments[loan.installments.length - 1];
  const target = explicit ?? current;
  if (!target) return { ok: false, error: "Loan has no installments." };

  // Enforce sequential cycle payment: you can't pay a later cycle until the
  // earlier ones are at least rolled.
  if (
    current &&
    target.cycleNumber > current.cycleNumber
  ) {
    return {
      ok: false,
      error: `Settle or roll cycle ${current.cycleNumber} before paying cycle ${target.cycleNumber}.`,
    };
  }

  const paidAt = parseIsoDate(d.paidAt);
  const now = nowInTz();

  // Recompute the loan state as it will be *after* this payment, then derive
  // the new installment + loan statuses from that projection.
  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: [...loan.payments, { amount: d.amount, installmentId: target.id }],
  });
  const { installmentStatuses, loanStatus, settled } = deriveStatuses(
    {
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      cyclesAllowed: loan.cyclesAllowed,
      installments: loan.installments,
      payments: [],
    },
    state,
    target.cycleNumber,
    loan.dueAt,
    now,
  );

  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        loanId: loan.id,
        installmentId: target.id,
        amount: toDbString(d.amount),
        paidAt,
        method: d.method,
        reference: d.reference?.trim() || null,
        note: d.note?.trim() || null,
        recordedById: user.id,
      },
    });

    for (const inst of loan.installments) {
      const status = installmentStatuses[inst.id] as InstallmentStatus;
      const newInterest = state.perInstallmentInterestOwed[inst.id];
      const updates: { status?: InstallmentStatus; expectedInterest?: string } = {};
      if (status !== inst.status) updates.status = status;
      if (newInterest && newInterest.toFixed(2) !== inst.expectedInterest.toString()) {
        updates.expectedInterest = newInterest.toFixed(2);
      }
      if (Object.keys(updates).length > 0) {
        await tx.installment.update({ where: { id: inst.id }, data: updates });
      }
    }

    if (loanStatus !== loan.status) {
      await tx.loan.update({ where: { id: loan.id }, data: { status: loanStatus } });
    }
  });

  await audit({
    actorId: user.id,
    action: "payment.record",
    entity: "Loan",
    entityId: loan.id,
    after: {
      amount: toDbString(d.amount),
      method: d.method,
      installmentCycle: target.cycleNumber,
      settled,
    },
  });

  revalidatePath(`/loans/${loan.id}`);
  revalidatePath("/loans");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { ok: true, loanId: loan.id, settled };
}

export type UpdatePaymentInput = {
  paymentId: string;
  amount: string;
  paidAt: string;
  method: PaymentInput["method"];
  reference?: string | null;
  note?: string | null;
  installmentId?: string | null;
};

/**
 * Edit a recorded payment in place, then re-derive the loan's installment +
 * loan status from all (updated) payments. Restricted to ADMIN + LOAN_OFFICER.
 */
export async function updatePayment(
  input: UpdatePaymentInput,
): Promise<PaymentResult> {
  try {
    let user;
    try {
      user = await requireRole(...WRITE_ROLES);
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    const existing = await db.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        loan: {
          include: {
            installments: { orderBy: { cycleNumber: "asc" } },
            payments: true,
          },
        },
      },
    });
    if (!existing) return { ok: false, error: "Payment not found." };

    const loan = existing.loan;
    const installmentId = input.installmentId || existing.installmentId || null;
    const target = installmentId
      ? loan.installments.find((i) => i.id === installmentId)
      : null;

    const paidAt = parseIsoDate(input.paidAt);
    const now = nowInTz();

    // Project the new payments list (replace this payment's amount + installmentId).
    const projectedPayments = loan.payments.map((p) =>
      p.id === existing.id
        ? { amount: input.amount, installmentId }
        : { amount: p.amount, installmentId: p.installmentId },
    );

    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: projectedPayments,
    });
    const { installmentStatuses, loanStatus, settled } = deriveStatuses(
      {
        principal: loan.principal,
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        cyclesAllowed: loan.cyclesAllowed,
        installments: loan.installments,
        payments: [],
      },
      state,
      target?.cycleNumber ?? loan.installments[0].cycleNumber,
      loan.dueAt,
      now,
    );

    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          amount: toDbString(input.amount),
          paidAt,
          method: input.method,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          installmentId,
        },
      });
      for (const inst of loan.installments) {
        const status = installmentStatuses[inst.id] as InstallmentStatus;
        const newInterest = state.perInstallmentInterestOwed[inst.id];
        const updates: { status?: InstallmentStatus; expectedInterest?: string } = {};
        if (status !== inst.status) updates.status = status;
        if (newInterest && newInterest.toFixed(2) !== inst.expectedInterest.toString()) {
          updates.expectedInterest = newInterest.toFixed(2);
        }
        if (Object.keys(updates).length > 0) {
          await tx.installment.update({ where: { id: inst.id }, data: updates });
        }
      }
      if (loanStatus !== loan.status) {
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: loanStatus },
        });
      }
    });

    await audit({
      actorId: user.id,
      action: "payment.update",
      entity: "Payment",
      entityId: existing.id,
      before: {
        amount: existing.amount.toString(),
        paidAt: existing.paidAt.toISOString(),
        method: existing.method,
        installmentId: existing.installmentId,
      },
      after: {
        amount: input.amount,
        paidAt: input.paidAt,
        method: input.method,
        installmentId,
      },
    });

    revalidatePath(`/loans/${loan.id}`);
    revalidatePath("/loans");
    revalidatePath("/payments");
    revalidatePath("/dashboard");
    return { ok: true, loanId: loan.id, settled };
  } catch (err) {
    console.error("[updatePayment] unhandled error", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not update payment: ${err.message}`
          : "Could not update payment (unknown error).",
    };
  }
}

/** Delete a payment and re-derive the loan's statuses. ADMIN-only. */
export async function deletePayment(
  paymentId: string,
): Promise<PaymentResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    const existing = await db.payment.findUnique({
      where: { id: paymentId },
      include: {
        loan: {
          include: {
            installments: { orderBy: { cycleNumber: "asc" } },
            payments: true,
          },
        },
      },
    });
    if (!existing) return { ok: false, error: "Payment not found." };

    const loan = existing.loan;
    const now = nowInTz();
    const projectedPayments = loan.payments
      .filter((p) => p.id !== existing.id)
      .map((p) => ({ amount: p.amount, installmentId: p.installmentId }));

    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: projectedPayments,
    });
    const targetCycle = existing.installmentId
      ? loan.installments.find((i) => i.id === existing.installmentId)?.cycleNumber ??
        loan.installments[0].cycleNumber
      : loan.installments[0].cycleNumber;
    const { installmentStatuses, loanStatus, settled } = deriveStatuses(
      {
        principal: loan.principal,
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        cyclesAllowed: loan.cyclesAllowed,
        installments: loan.installments,
        payments: [],
      },
      state,
      targetCycle,
      loan.dueAt,
      now,
    );

    await db.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: existing.id } });
      for (const inst of loan.installments) {
        const status = installmentStatuses[inst.id] as InstallmentStatus;
        const newInterest = state.perInstallmentInterestOwed[inst.id];
        const updates: { status?: InstallmentStatus; expectedInterest?: string } = {};
        if (status !== inst.status) updates.status = status;
        if (newInterest && newInterest.toFixed(2) !== inst.expectedInterest.toString()) {
          updates.expectedInterest = newInterest.toFixed(2);
        }
        if (Object.keys(updates).length > 0) {
          await tx.installment.update({ where: { id: inst.id }, data: updates });
        }
      }
      if (loanStatus !== loan.status) {
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: loanStatus },
        });
      }
    });

    await audit({
      actorId: user.id,
      action: "payment.delete",
      entity: "Payment",
      entityId: existing.id,
      before: {
        amount: existing.amount.toString(),
        paidAt: existing.paidAt.toISOString(),
        method: existing.method,
        installmentId: existing.installmentId,
      },
    });

    revalidatePath(`/loans/${loan.id}`);
    revalidatePath("/loans");
    revalidatePath("/payments");
    revalidatePath("/dashboard");
    return { ok: true, loanId: loan.id, settled };
  } catch (err) {
    console.error("[deletePayment] unhandled error", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not delete payment: ${err.message}`
          : "Could not delete payment (unknown error).",
    };
  }
}
