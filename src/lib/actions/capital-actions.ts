"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError } from "@/lib/rbac";
import { toDbString } from "@/lib/money";
import { parseIsoDate } from "@/lib/dates";
import { CapitalType, PaymentMethod } from "@/generated/prisma/enums";

export type CapitalResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const amount = z
  .string()
  .trim()
  .regex(/^[0-9]+(\.[0-9]{1,2})?$/, "Enter a valid amount")
  .refine((v) => Number(v) > 0, "Amount must be greater than zero");

const optionalText = z.string().trim().optional().or(z.literal(""));

const sourceSchema = z.object({
  sourceName: z.string().trim().min(2, "Who did the money come from?"),
  type: z.nativeEnum(CapitalType),
  amount,
  interestRatePct: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,2})?$/, "Enter a valid rate")
    .optional()
    .or(z.literal("")),
  rateNote: optionalText,
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
    .optional()
    .or(z.literal("")),
  notes: optionalText,
});

export type CapitalSourceInput = z.infer<typeof sourceSchema>;

export async function createCapitalSource(
  input: CapitalSourceInput,
): Promise<CapitalResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN", "ACCOUNTANT");
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
    const parsed = sourceSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Please fix the highlighted fields.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const d = parsed.data;
    const created = await db.capitalSource.create({
      data: {
        sourceName: d.sourceName.trim(),
        type: d.type,
        amount: toDbString(d.amount),
        interestRatePct: d.interestRatePct ? toDbString(d.interestRatePct) : null,
        rateNote: d.rateNote?.trim() || null,
        receivedAt: parseIsoDate(d.receivedAt),
        dueAt: d.dueAt ? parseIsoDate(d.dueAt) : null,
        notes: d.notes?.trim() || null,
        recordedById: user.id,
        recordedByName: user.name ?? user.email ?? "Staff",
      },
    });
    await audit({
      actorId: user.id,
      action: "capital.create",
      entity: "CapitalSource",
      entityId: created.id,
      after: { sourceName: d.sourceName, amount: d.amount, type: d.type },
    });
    revalidatePath("/capital");
    revalidatePath("/dashboard");
    return { ok: true, id: created.id };
  } catch (err) {
    console.error("[createCapitalSource]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not save: ${err.message}`
          : "Could not save capital source.",
    };
  }
}

const repaymentSchema = z.object({
  capitalSourceId: z.string().min(1),
  amount,
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  method: z.nativeEnum(PaymentMethod),
  note: optionalText,
});

export type CapitalRepaymentInput = z.infer<typeof repaymentSchema>;

export async function recordCapitalRepayment(
  input: CapitalRepaymentInput,
): Promise<CapitalResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN", "ACCOUNTANT");
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
    const parsed = repaymentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Please fix the highlighted fields.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const d = parsed.data;
    const source = await db.capitalSource.findUnique({
      where: { id: d.capitalSourceId },
    });
    if (!source) return { ok: false, error: "Capital source not found." };

    await db.capitalRepayment.create({
      data: {
        capitalSourceId: d.capitalSourceId,
        amount: toDbString(d.amount),
        paidAt: parseIsoDate(d.paidAt),
        method: d.method,
        note: d.note?.trim() || null,
        recordedById: user.id,
      },
    });
    await audit({
      actorId: user.id,
      action: "capital.repay",
      entity: "CapitalSource",
      entityId: d.capitalSourceId,
      after: { amount: d.amount, method: d.method },
    });
    revalidatePath("/capital");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    console.error("[recordCapitalRepayment]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not save: ${err.message}`
          : "Could not record repayment.",
    };
  }
}

/** Delete a capital source and its repayments (ADMIN only). */
export async function deleteCapitalSource(id: string): Promise<CapitalResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
    await db.capitalSource.delete({ where: { id } });
    await audit({
      actorId: user.id,
      action: "capital.delete",
      entity: "CapitalSource",
      entityId: id,
    });
    revalidatePath("/capital");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    console.error("[deleteCapitalSource]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not delete: ${err.message}`
          : "Could not delete capital source.",
    };
  }
}
