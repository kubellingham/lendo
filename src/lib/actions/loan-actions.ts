"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { loanSchema, type LoanInput } from "@/lib/validation";
import { generateSchedule } from "@/lib/schedule";
import { toDbString } from "@/lib/money";
import { parseIsoDate } from "@/lib/dates";
import { Role } from "@/generated/prisma/enums";

export type LoanActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** Customer is blacklisted; issuance blocked. */
      requiresOverride?: boolean;
      /** True when the acting user (ADMIN) may override the block. */
      canOverride?: boolean;
    };

/** A customer is actively blacklisted when their current flag is BLACKLIST. */
function isBlacklisted(c: { isFlagged: boolean; flagReason: string | null }): boolean {
  return c.isFlagged && (c.flagReason ?? "").startsWith("BLACKLIST");
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

  // Blacklist gate.
  if (isBlacklisted(customer)) {
    const canOverride = user.role === Role.ADMIN;
    if (!d.overrideBlacklist) {
      return {
        ok: false,
        requiresOverride: true,
        canOverride,
        error: canOverride
          ? "This customer is blacklisted. Confirm the override to proceed."
          : "This customer is blacklisted. Only an administrator can issue a loan.",
      };
    }
    if (!canOverride) {
      return {
        ok: false,
        error: "Only an administrator can override a blacklist.",
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

  if (isBlacklisted(customer) && d.overrideBlacklist) {
    await audit({
      actorId: user.id,
      action: "loan.blacklist_override",
      entity: "Loan",
      entityId: loan.id,
      after: { customerId: customer.id, reason: d.overrideReason },
    });
  }

  revalidatePath("/loans");
  revalidatePath(`/customers/${customer.id}`);
  redirect(`/loans/${loan.id}`);
}
