"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";

export type ReferralResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const schema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  phone: z.string().trim().min(6, "Phone is required"),
  relationship: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type ReferralInput = z.infer<typeof schema> & { id?: string };

/**
 * Link (or unlink) one customer to a referral. Mirrors the referral's
 * contact details into the customer's inline fallback fields so messaging
 * keeps working from either side. Pass referralId=null to unlink.
 */
export async function setCustomerReferral(
  customerId: string,
  referralId: string | null,
): Promise<ReferralResult> {
  try {
    let user;
    try {
      user = await requireRole(...WRITE_ROLES);
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
    if (!customerId) return { ok: false, error: "Missing customer." };

    if (referralId) {
      const r = await db.referral.findUnique({ where: { id: referralId } });
      if (!r) return { ok: false, error: "Referral not found." };
      await db.customer.update({
        where: { id: customerId },
        data: {
          referralId: r.id,
          referralName: r.name,
          referralPhone: r.phone,
          referralRelationship: r.relationship,
        },
      });
    } else {
      await db.customer.update({
        where: { id: customerId },
        data: {
          referralId: null,
          referralName: null,
          referralPhone: null,
          referralRelationship: null,
        },
      });
    }

    await audit({
      actorId: user.id,
      action: referralId ? "referral.link_customer" : "referral.unlink_customer",
      entity: "Customer",
      entityId: customerId,
      after: { referralId },
    });
    revalidatePath("/referrals");
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, id: customerId };
  } catch (err) {
    console.error("[setCustomerReferral]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update link.",
    };
  }
}

export async function saveReferral(input: ReferralInput): Promise<ReferralResult> {
  try {
    let user;
    try {
      user = await requireRole(...WRITE_ROLES);
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid referral.",
      };
    }
    const d = parsed.data;
    const data = {
      name: d.name,
      phone: d.phone,
      relationship: d.relationship?.trim() || null,
      notes: d.notes?.trim() || null,
    };

    // Phone is unique — block collisions with a clear message.
    const clash = await db.referral.findUnique({ where: { phone: d.phone } });
    if (clash && clash.id !== input.id) {
      return {
        ok: false,
        error: `That phone is already saved under "${clash.name}".`,
      };
    }

    let id: string;
    if (input.id) {
      const updated = await db.referral.update({
        where: { id: input.id },
        data,
      });
      id = updated.id;
      // Keep linked borrowers' inline copies in sync with the edited contact.
      await db.customer.updateMany({
        where: { referralId: id },
        data: {
          referralName: data.name,
          referralPhone: data.phone,
          referralRelationship: data.relationship,
        },
      });
    } else {
      const created = await db.referral.create({
        data: { ...data, createdById: user.id },
      });
      id = created.id;
    }

    await audit({
      actorId: user.id,
      action: input.id ? "referral.update" : "referral.create",
      entity: "Referral",
      entityId: id,
      after: data,
    });
    revalidatePath("/referrals");
    return { ok: true, id };
  } catch (err) {
    console.error("[saveReferral]", err);
    return {
      ok: false,
      error:
        err instanceof Error ? `Could not save: ${err.message}` : "Could not save referral.",
    };
  }
}
