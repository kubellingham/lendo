"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError } from "@/lib/rbac";
import { toDbString, round2, money } from "@/lib/money";
import { interestByMonth, type TitheLoan } from "@/lib/tithes";
import { getTitheRatePct } from "@/lib/settings";

export type TitheResult =
  | { ok: true; period: string }
  | { ok: false; error: string };

async function loansForTithe(): Promise<TitheLoan[]> {
  const loans = await db.loan.findMany({
    include: {
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        select: {
          id: true,
          amount: true,
          installmentId: true,
          paidAt: true,
          createdAt: true,
        },
      },
    },
  });
  return loans as unknown as TitheLoan[];
}

/**
 * Record (or update) the tithe submission for a month. Recomputes the interest
 * collected in that month at submission time and stores 10% of it. ADMIN only.
 */
export async function submitTithe(
  period: string,
  note?: string,
): Promise<TitheResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return { ok: false, error: "Invalid period." };
    }

    const ratePct = await getTitheRatePct();
    const loans = await loansForTithe();
    const interest = interestByMonth(loans).get(period) ?? money(0);
    const amount = round2(interest.times(ratePct).div(100));

    await db.tithePayment.upsert({
      where: { period },
      update: {
        interestBase: toDbString(interest),
        ratePct,
        amount: toDbString(amount),
        submittedById: user.id,
        submittedByName: user.name ?? user.email ?? "Admin",
        note: note?.trim() || null,
        submittedAt: new Date(),
      },
      create: {
        period,
        interestBase: toDbString(interest),
        ratePct,
        amount: toDbString(amount),
        submittedById: user.id,
        submittedByName: user.name ?? user.email ?? "Admin",
        note: note?.trim() || null,
      },
    });

    await audit({
      actorId: user.id,
      action: "tithe.submit",
      entity: "TithePayment",
      entityId: period,
      after: { period, interestBase: toDbString(interest), amount: toDbString(amount) },
    });

    revalidatePath("/tithes");
    return { ok: true, period };
  } catch (err) {
    console.error("[submitTithe]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not submit tithe: ${err.message}`
          : "Could not submit tithe.",
    };
  }
}

/** Undo a tithe submission (mark the month as pending again). ADMIN only. */
export async function unsubmitTithe(period: string): Promise<TitheResult> {
  try {
    let user;
    try {
      user = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }

    await db.tithePayment.deleteMany({ where: { period } });
    await audit({
      actorId: user.id,
      action: "tithe.unsubmit",
      entity: "TithePayment",
      entityId: period,
    });

    revalidatePath("/tithes");
    return { ok: true, period };
  } catch (err) {
    console.error("[unsubmitTithe]", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not update tithe: ${err.message}`
          : "Could not update tithe.",
    };
  }
}
