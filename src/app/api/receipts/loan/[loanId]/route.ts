import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { buildReceiptPdf, type ReceiptRow } from "@/lib/pdf/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tsh(n: unknown): string {
  const num = Number(n ?? 0);
  return (
    "TSh " +
    new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(
      Number.isFinite(num) ? Math.round(num) : 0,
    )
  );
}

function loanRef(loanId: string): string {
  return "LND-" + loanId.slice(-6).toUpperCase();
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  SETTLED: "Fully repaid",
  OVERDUE: "Overdue",
  DEFAULTED: "Defaulted",
  WRITTEN_OFF: "Written off",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ loanId: string }> },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { loanId } = await params;
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      customer: { select: { fullName: true, phone: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        orderBy: { paidAt: "asc" },
        include: { installment: { select: { cycleNumber: true } } },
      },
    },
  });
  if (!loan) return new NextResponse("Loan not found", { status: 404 });

  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: loan.payments.map((p) => ({
      amount: p.amount,
      installmentId: p.installmentId,
    })),
  });
  const settled = state.principalOutstanding.lte(0);

  const summary: ReceiptRow[] = [
    { label: "Loan reference", value: loanRef(loan.id) },
    { label: "Status", value: STATUS_LABEL[loan.status] ?? loan.status },
    { label: "Principal", value: tsh(loan.principal) },
    { label: "Interest rate", value: `${loan.interestRatePct}% per 30-day cycle` },
    { label: "Disbursed on", value: formatDate(loan.disbursedAt) },
    { label: "Final due date", value: formatDate(loan.dueAt) },
    { label: "Total collected", value: tsh(state.totalCollected) },
    { label: "  · of which interest", value: tsh(state.interestCollected) },
    { label: "  · of which principal", value: tsh(state.principalCollected) },
    {
      label: settled ? "Balance" : "Principal outstanding",
      value: tsh(state.principalOutstanding),
      strong: true,
    },
  ];

  // Schedule table.
  const scheduleRows = loan.installments.map((i) => [
    `Cycle ${i.cycleNumber}`,
    formatDate(i.dueDate),
    tsh(state.perInstallmentOpeningPrincipal[i.id] ?? "0"),
    tsh(state.perInstallmentInterestOwed[i.id] ?? i.expectedInterest.toString()),
    tsh(state.perInstallmentPaid[i.id] ?? "0"),
  ]);

  const pdf = await buildReceiptPdf({
    docTitle: "LOAN STATEMENT",
    reference: loanRef(loan.id),
    issuedOn: formatDateTime(new Date()),
    customerName: loan.customer.fullName,
    customerPhone: loan.customer.phone,
    summary,
    highlight: settled
      ? { label: "Balance", value: "TSh 0  ·  Fully repaid" }
      : { label: "Settlement amount today", value: tsh(state.settlementAmountNow) },
    table: {
      title: "Repayment schedule",
      columns: ["Cycle", "Due date", "Opening principal", "Interest", "Paid"],
      rightAlign: [2, 3, 4],
      rows: scheduleRows,
    },
    footerNote: settled
      ? "This loan is fully settled. Thank you for banking with Lendo."
      : `Interest is ${loan.interestRatePct}% of the outstanding principal each cycle.`,
    tagline: settled
      ? "Helping you move forward."
      : "Borrow with confidence. Repay with ease.",
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-Statement-${loanRef(loan.id)}.pdf"`,
    },
  });
}
