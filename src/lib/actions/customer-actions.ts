"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import {
  customerSchema,
  flagSchema,
  type CustomerInput,
  type FlagInput,
} from "@/lib/validation";
import { FlagSeverity } from "@/generated/prisma/enums";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function emptyToNull(v?: string | null): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function handleAuthError(err: unknown): ActionResult {
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  throw err;
}

export async function createCustomer(input: CustomerInput): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    return handleAuthError(err);
  }

  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const customer = await db.customer.create({
    data: {
      type: d.type,
      fullName: d.fullName.trim(),
      businessName: emptyToNull(d.businessName),
      nationalIdNumber: emptyToNull(d.nationalIdNumber),
      phone: d.phone.trim(),
      altPhone: emptyToNull(d.altPhone),
      email: emptyToNull(d.email),
      addressLine: d.addressLine.trim(),
      city: d.city.trim(),
      region: d.region.trim(),
      occupation: emptyToNull(d.occupation),
      employer: emptyToNull(d.employer),
      businessTin: emptyToNull(d.businessTin),
      notes: emptyToNull(d.notes),
      createdById: user.id,
    },
  });

  await audit({
    actorId: user.id,
    action: "customer.create",
    entity: "Customer",
    entityId: customer.id,
    after: { fullName: customer.fullName, phone: customer.phone, type: customer.type },
  });

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    return handleAuthError(err);
  }

  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const before = await db.customer.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Customer not found." };

  const customer = await db.customer.update({
    where: { id },
    data: {
      type: d.type,
      fullName: d.fullName.trim(),
      businessName: emptyToNull(d.businessName),
      nationalIdNumber: emptyToNull(d.nationalIdNumber),
      phone: d.phone.trim(),
      altPhone: emptyToNull(d.altPhone),
      email: emptyToNull(d.email),
      addressLine: d.addressLine.trim(),
      city: d.city.trim(),
      region: d.region.trim(),
      occupation: emptyToNull(d.occupation),
      employer: emptyToNull(d.employer),
      businessTin: emptyToNull(d.businessTin),
      notes: emptyToNull(d.notes),
    },
  });

  await audit({
    actorId: user.id,
    action: "customer.update",
    entity: "Customer",
    entityId: id,
    before: { fullName: before.fullName, phone: before.phone },
    after: { fullName: customer.fullName, phone: customer.phone },
  });

  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

/**
 * Add a flag to a customer's history. Setting a HIGH or BLACKLIST flag also
 * sets the customer's `isFlagged` boolean and a summary reason.
 */
export async function addCustomerFlag(input: FlagInput): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    return handleAuthError(err);
  }

  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please provide a valid reason and severity." };
  }
  const { customerId, reason, severity } = parsed.data;

  await db.$transaction(async (tx) => {
    await tx.customerFlag.create({
      data: { customerId, reason: reason.trim(), severity, createdById: user.id },
    });
    // A flag always marks the customer; severity is reflected in the summary.
    await tx.customer.update({
      where: { id: customerId },
      data: { isFlagged: true, flagReason: `${severity}: ${reason.trim()}` },
    });
  });

  await audit({
    actorId: user.id,
    action: "customer.flag",
    entity: "Customer",
    entityId: customerId,
    after: { severity, reason },
  });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { ok: true, id: customerId };
}

/** Clear the active flag (keeps flag history). */
export async function clearCustomerFlag(customerId: string): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    return handleAuthError(err);
  }

  await db.customer.update({
    where: { id: customerId },
    data: { isFlagged: false, flagReason: null },
  });

  await audit({
    actorId: user.id,
    action: "customer.unflag",
    entity: "Customer",
    entityId: customerId,
  });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { ok: true, id: customerId };
}

export const FLAG_SEVERITIES = Object.values(FlagSeverity);
