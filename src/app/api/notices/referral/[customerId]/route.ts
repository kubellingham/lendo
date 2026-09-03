import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getReferralOverdue, num } from "@/lib/referral";
import { buildReceiptPdf, type ReceiptRow } from "@/lib/pdf/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { customerId } = await params;
  const summary = await getReferralOverdue(customerId);
  if (!summary) return new NextResponse("Customer not found", { status: 404 });
  if (summary.loans.length === 0) {
    return new NextResponse("No overdue loans", { status: 404 });
  }

  const rows = summary.loans.map((l) => [
    l.loanRef,
    formatDate(l.dueDate),
    l.daysOverdue > 0 ? `${l.daysOverdue}` : "0",
    "TSh " + num(l.amountDue),
  ]);

  const infoRows: ReceiptRow[] = [
    { label: "Borrower", value: summary.borrowerName },
    {
      label: "Overdue loans",
      value: String(summary.loans.length),
    },
  ];

  const pdf = await buildReceiptPdf({
    docTitle: "REFERRAL NOTICE",
    reference: "REF-" + customerId.slice(-6).toUpperCase(),
    issuedOn: formatDateTime(new Date()),
    customerName: summary.referralName || "Referral",
    customerPhone: summary.referralPhone || "—",
    summary: infoRows,
    highlight: {
      label: "Total outstanding",
      value: "TSh " + num(summary.total),
    },
    table: {
      title: "Outstanding loans",
      columns: ["Loan", "Was due", "Days overdue", "Amount"],
      rightAlign: [2, 3],
      rows,
    },
    footerNote:
      "Kindly remind your referral to clear the total outstanding amount as soon as possible.",
    tagline: "Helping you move forward.",
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-Referral-Notice-${summary.borrowerName.replace(/\s+/g, "-")}.pdf"`,
    },
  });
}
