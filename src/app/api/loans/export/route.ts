import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { parseIsoDate } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from")
    ? parseIsoDate(url.searchParams.get("from")!)
    : undefined;
  const to = url.searchParams.get("to")
    ? parseIsoDate(url.searchParams.get("to")!)
    : undefined;

  const loans = await db.loan.findMany({
    where: from || to ? { disbursedAt: { gte: from, lte: to } } : undefined,
    include: {
      customer: { select: { fullName: true, phone: true } },
      issuedBy: { select: { name: true } },
      installments: true,
      payments: { select: { amount: true, installmentId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const lines: string[] = [
    [
      "disbursedAt",
      "dueAt",
      "customer",
      "phone",
      "principal",
      "paid",
      "interest_collected",
      "principal_outstanding",
      "status",
      "officer",
    ].join(","),
  ];

  for (const loan of loans) {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount,
        installmentId: p.installmentId,
      })),
    });
    lines.push(
      [
        loan.disbursedAt.toISOString().slice(0, 10),
        loan.dueAt.toISOString().slice(0, 10),
        csvEscape(loan.customer.fullName),
        loan.customer.phone,
        loan.principal.toString(),
        state.totalCollected.toString(),
        state.interestCollected.toString(),
        state.principalOutstanding.toString(),
        loan.status,
        csvEscape(loan.issuedBy.name),
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="lendo-loans.csv"',
    },
  });
}
