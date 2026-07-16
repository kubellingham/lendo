import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSchedule } from "@/lib/schedule";
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
      customer: {
        select: {
          fullName: true,
          phone: true,
          nationalIdNumber: true,
          addressLine: true,
          city: true,
          region: true,
        },
      },
      issuedBy: { select: { name: true } },
    },
  });
  if (!loan) return new NextResponse("Loan not found", { status: 404 });

  // Projected schedule at disbursal (no payments yet): reducing-balance with an
  // unchanged principal means each cycle's interest is rate% of principal.
  const schedule = generateSchedule({
    principal: loan.principal.toString(),
    disbursedAt: loan.disbursedAt,
    interestRatePct: loan.interestRatePct,
    cyclesAllowed: loan.cyclesAllowed,
    cycleDays: loan.cycleDays,
  });

  const address = [
    loan.customer.addressLine,
    loan.customer.city,
    loan.customer.region,
  ]
    .filter(Boolean)
    .join(", ");

  const summary: ReceiptRow[] = [
    { label: "Loan reference", value: loanRef(loan.id) },
    { label: "Disbursed on", value: formatDate(loan.disbursedAt) },
    { label: "Issued by", value: loan.issuedBy.name },
    ...(loan.customer.nationalIdNumber
      ? [{ label: "National ID", value: loan.customer.nationalIdNumber }]
      : []),
    ...(address ? [{ label: "Address", value: address }] : []),
    { label: "Interest rate", value: `${loan.interestRatePct}% per 30-day cycle` },
    {
      label: "Term",
      value: `${loan.cyclesAllowed} cycles of ${loan.cycleDays} days (max ${loan.cyclesAllowed * loan.cycleDays} days)`,
    },
    { label: "Final due date", value: formatDate(loan.dueAt) },
    { label: "Maximum total interest", value: tsh(schedule.maxTotalInterest) },
    {
      label: "Maximum total repayable",
      value: tsh(schedule.maxTotalRepayment),
      strong: true,
    },
  ];

  const scheduleRows = schedule.installments.map((i) => [
    `Cycle ${i.cycleNumber}`,
    formatDate(i.dueDate),
    tsh(i.interestOnlyAmount),
    tsh(i.fullSettlementAmount) + (i.isMandatorySettlement ? " *" : ""),
  ]);

  const pdf = await buildReceiptPdf({
    docTitle: "LOAN DISBURSEMENT",
    reference: loanRef(loan.id),
    issuedOn: formatDateTime(new Date()),
    customerName: loan.customer.fullName,
    customerPhone: loan.customer.phone,
    summary,
    highlight: { label: "Amount disbursed", value: tsh(loan.principal) },
    table: {
      title: "Repayment options per cycle",
      columns: ["Cycle", "Due date", "Interest only (roll)", "Pay to settle"],
      rightAlign: [2, 3],
      rows: scheduleRows,
    },
    footerNote:
      "* Full settlement is mandatory at the final cycle. Interest is charged on the outstanding principal; paying down principal early reduces later interest.",
    tagline: "Borrow with confidence. Repay with ease.",
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-Disbursement-${loanRef(loan.id)}.pdf"`,
    },
  });
}
