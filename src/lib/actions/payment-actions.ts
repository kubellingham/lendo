"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { paymentSchema, type PaymentInput } from "@/lib/validation";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
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

  const paidAt = parseIsoDate(d.paidAt);
  const now = nowInTz();

  // Recompute the loan state as it will be *after* this payment, then derive
  // the new installment + loan statuses from that projection.
  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    installments: loan.installments,
    payments: [...loan.payments, { amount: d.amount, installmentId: target.id }],
  });
  const { installmentStatuses, loanStatus, settled } = deriveStatuses(
    { principal: loan.principal, status: loan.status, installments: loan.installments, payments: [] },
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
      if (status !== inst.status) {
        await tx.installment.update({ where: { id: inst.id }, data: { status } });
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
