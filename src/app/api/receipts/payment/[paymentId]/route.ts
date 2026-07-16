import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { formatDateTime } from "@/lib/dates";
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { paymentId } = await params;
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      recordedBy: { select: { name: true } },
      installment: { select: { cycleNumber: true } },
      loan: {
        include: {
          customer: { select: { fullName: true, phone: true } },
          installments: { orderBy: { cycleNumber: "asc" } },
          payments: { select: { amount: true, installmentId: true } },
        },
      },
    },
  });
  if (!payment) return new NextResponse("Payment not found", { status: 404 });

  const loan = payment.loan;
  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    interestRatePct: loan.interestRatePct,
    installments: loan.installments,
    payments: loan.payments,
  });
  const settled = state.principalOutstanding.lte(0);

  const summary: ReceiptRow[] = [
    { label: "Loan reference", value: loanRef(loan.id) },
    {
      label: "Cycle",
      value: payment.installment
        ? `Cycle ${payment.installment.cycleNumber}`
        : "—",
    },
    { label: "Payment method", value: payment.method },
    ...(payment.reference
      ? [{ label: "Transaction ref", value: payment.reference }]
      : []),
    { label: "Received on", value: formatDateTime(payment.paidAt) },
    { label: "Recorded by", value: payment.recordedBy.name },
    {
      label: settled ? "Remaining balance" : "Principal outstanding",
      value: tsh(state.principalOutstanding),
      strong: true,
    },
  ];

  const pdf = await buildReceiptPdf({
    docTitle: "PAYMENT RECEIPT",
    reference: loanRef(loan.id),
    issuedOn: formatDateTime(new Date()),
    customerName: loan.customer.fullName,
    customerPhone: loan.customer.phone,
    summary,
    highlight: { label: "Amount received", value: tsh(payment.amount) },
    footerNote: settled
      ? "This loan is now fully settled. Thank you for your trust."
      : undefined,
    tagline: settled
      ? "Helping you move forward."
      : "Borrow with confidence. Repay with ease.",
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-Receipt-${loanRef(loan.id)}.pdf"`,
    },
  });
}
