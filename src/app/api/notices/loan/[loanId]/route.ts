import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { buildReceiptPdf, type ReceiptDoc, type ReceiptRow } from "@/lib/pdf/receipt";

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
function loanRef(id: string) {
  return "LND-" + id.slice(-6).toUpperCase();
}

// Maps a message situation to a branded PDF document.
const REPAY_TAGLINE = "Borrow with confidence. Repay with ease.";
const FORWARD_TAGLINE = "Helping you move forward.";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ loanId: string }> },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { loanId } = await params;
  const type = new URL(req.url).searchParams.get("type") ?? "reminder_7d";

  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      customer: { select: { fullName: true, phone: true } },
      issuedBy: { select: { name: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        orderBy: { paidAt: "desc" },
        select: { amount: true, installmentId: true, paidAt: true },
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

  const currentInst = loan.installments.find(
    (i) => i.status !== "SETTLED" && i.status !== "INTEREST_PAID",
  );
  const dueDateSource =
    currentInst?.dueDate ?? loan.dueAt ?? loan.installments[0].dueDate;
  const daysOverdue = Math.max(
    0,
    Math.floor((Date.now() - dueDateSource.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const interestForCurrent = currentInst
    ? state.perInstallmentInterestOwed[currentInst.id]
    : state.interestOnlyNow;
  const lastPayment = loan.payments[0];

  const base = {
    reference: loanRef(loan.id),
    issuedOn: formatDateTime(new Date()),
    customerName: loan.customer.fullName,
    customerPhone: loan.customer.phone,
  };

  let doc: ReceiptDoc;
  switch (type) {
    case "reminder_7d":
    case "reminder_3d":
    case "due_today": {
      const when =
        type === "due_today"
          ? "Payment is due today"
          : type === "reminder_3d"
            ? "Payment due in 3 days"
            : "Payment due in 7 days";
      const summary: ReceiptRow[] = [
        { label: "Loan reference", value: loanRef(loan.id) },
        { label: "Due date", value: formatDate(dueDateSource) },
        { label: "Interest rate", value: `${loan.interestRatePct}% per cycle` },
        { label: "Principal", value: tsh(loan.principal) },
        { label: "Interest due", value: tsh(interestForCurrent) },
        { label: "Balance", value: tsh(state.principalOutstanding), strong: true },
      ];
      doc = {
        ...base,
        docTitle: "PAYMENT REMINDER",
        summary,
        highlight: { label: "Total due", value: tsh(state.settlementAmountNow) },
        footerNote: `${when}. Please pay on time to keep your account in good standing.`,
        tagline: REPAY_TAGLINE,
      };
      break;
    }
    case "overdue": {
      const summary: ReceiptRow[] = [
        { label: "Loan reference", value: loanRef(loan.id) },
        { label: "Was due", value: formatDate(dueDateSource) },
        { label: "Days overdue", value: String(daysOverdue) },
        { label: "Balance", value: tsh(state.principalOutstanding), strong: true },
      ];
      doc = {
        ...base,
        docTitle: "OVERDUE NOTICE",
        summary,
        highlight: { label: "Total due", value: tsh(state.settlementAmountNow) },
        footerNote:
          "This payment is overdue. Please settle as soon as possible, or contact us to arrange a way forward.",
        tagline: FORWARD_TAGLINE,
      };
      break;
    }
    case "loan_settled": {
      const summary: ReceiptRow[] = [
        { label: "Loan reference", value: loanRef(loan.id) },
        { label: "Cleared on", value: lastPayment ? formatDate(lastPayment.paidAt) : "—" },
        { label: "Total repaid", value: tsh(state.totalCollected) },
        { label: "Balance", value: "TSh 0", strong: true },
      ];
      doc = {
        ...base,
        docTitle: "LOAN CLEARED",
        summary,
        highlight: { label: "Balance", value: "TSh 0 · Fully repaid" },
        footerNote:
          "This loan is fully settled. Thank you for your trust — you're welcome to borrow again anytime.",
        tagline: FORWARD_TAGLINE,
      };
      break;
    }
    case "loan_approved": {
      const summary: ReceiptRow[] = [
        { label: "Loan reference", value: loanRef(loan.id) },
        { label: "Interest rate", value: `${loan.interestRatePct}% per cycle` },
        { label: "Approved amount", value: tsh(loan.principal), strong: true },
      ];
      doc = {
        ...base,
        docTitle: "LOAN APPROVED",
        summary,
        highlight: { label: "Approved amount", value: tsh(loan.principal) },
        footerNote:
          "Your loan has been approved. Disbursal will be processed shortly.",
        tagline: REPAY_TAGLINE,
      };
      break;
    }
    default: {
      const summary: ReceiptRow[] = [
        { label: "Loan reference", value: loanRef(loan.id) },
        { label: "Balance", value: tsh(state.principalOutstanding), strong: true },
      ];
      doc = {
        ...base,
        docTitle: "LOAN NOTICE",
        summary,
        tagline: REPAY_TAGLINE,
      };
    }
  }

  const pdf = await buildReceiptPdf(doc);
  const label = doc.docTitle.replace(/\s+/g, "-");
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-${label}-${loanRef(loan.id)}.pdf"`,
    },
  });
}
