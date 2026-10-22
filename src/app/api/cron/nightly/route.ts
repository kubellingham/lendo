import { NextResponse } from "next/server";
import { checkBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { ensureLoanCycles } from "@/lib/loan-maintenance";
import { recomputeAllRisk } from "@/lib/customer-risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly upkeep (Vercel Cron, see vercel.json; Vercel sends CRON_SECRET as a
 * bearer token): adds any cycles a running loan needs, refreshes installment and
 * loan statuses, and recomputes customer risk, so Lendo's pages stay current
 * even when nobody opens a loan.
 */
export async function GET(req: Request) {
  const access = checkBearer(
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
    8,
  );
  if (access !== "ok") {
    return NextResponse.json(
      {
        error: access === "unconfigured" ? "Not configured" : "Not authorised",
      },
      { status: access === "unconfigured" ? 503 : 401 },
    );
  }

  const loans = await db.loan.findMany({
    where: { status: { in: ["ACTIVE", "OVERDUE", "DEFAULTED"] } },
    select: { id: true },
  });
  let failed = 0;
  for (const loan of loans) {
    try {
      await ensureLoanCycles(loan.id);
    } catch (error) {
      failed++;
      console.error("Nightly upkeep failed for a loan", loan.id, error);
    }
  }
  const customers = await recomputeAllRisk();
  return NextResponse.json({ loans: loans.length, failed, customers });
}
