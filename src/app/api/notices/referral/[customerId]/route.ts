import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import {
  getReferralOverdue,
  getReferralUpcoming,
  dueWhen,
  num,
} from "@/lib/referral";
import { buildReceiptPdf, type ReceiptRow } from "@/lib/pdf/receipt";
import { getPaymentDetails } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if ((session.user as { role?: string }).role === "DEMO_VIEWER") {
    return new NextResponse("Not available in demo mode", { status: 403 });
  }

  const { customerId } = await params;
  const pay = await getPaymentDetails();

  if (new URL(req.url).searchParams.get("type") === "upcoming") {
    const up = await getReferralUpcoming(customerId);
    if (!up) return new NextResponse("Customer not found", { status: 404 });
    if (up.loans.length === 0) {
      return new NextResponse("No upcoming payments", { status: 404 });
    }
    const pdf = await buildReceiptPdf({
      docTitle: "UPCOMING PAYMENTS",
      reference: "REF-" + customerId.slice(-6).toUpperCase(),
      issuedOn: formatDateTime(new Date()),
      customerName: up.referralName || "Referral",
      customerPhone: up.referralPhone || "—",
      summary: [
        { label: "Borrower", value: up.borrowerName },
        { label: "Upcoming payments", value: String(up.loans.length) },
        {
          label: "To clear everything",
          value: "TSh " + num(up.totalToSettle),
        },
        { label: "— How they can pay —", value: "" },
        { label: "Bank", value: pay.bank },
        { label: "Account name", value: pay.accountName },
        { label: "Account number", value: pay.accountNumber },
      ],
      highlight: {
        label: "Minimum due",
        value: "TSh " + num(up.totalMinimum),
      },
      table: {
        title: "Upcoming payments",
        columns: ["Loan", "Due", "Minimum due", "To clear"],
        rightAlign: [2, 3],
        rows: up.loans.map((l) => [
          l.loanRef + (l.isFinalCycle ? " (final)" : ""),
          `${formatDate(l.dueDate)} (${dueWhen(l.daysUntilDue)})`,
          "TSh " + num(l.minimumDue),
          "TSh " + num(l.settleAmount),
        ]),
      },
      footerNote:
        "Kindly remind your referral so each payment is made on time. Final-cycle loans must be settled in full.",
      tagline: "Borrow with confidence. Repay with ease.",
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="Lendo-Referral-Upcoming-${up.borrowerName.replace(/\s+/g, "-")}.pdf"`,
      },
    });
  }

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
    { label: "— How they can pay —", value: "" },
    { label: "Bank", value: pay.bank },
    { label: "Account name", value: pay.accountName },
    { label: "Account number", value: pay.accountNumber },
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
