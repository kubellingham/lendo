import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";
import { buildReceiptPdf } from "@/lib/pdf/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A sample receipt with made-up figures, to check the branding.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return new NextResponse("Not allowed", { status: 403 });
  const pdf = await buildReceiptPdf({
    docTitle: "PAYMENT RECEIPT",
    reference: "LND-SAMPLE",
    issuedOn: formatDateTime(new Date()),
    customerName: "Sample Customer",
    customerPhone: "+255 700 000 000",
    summary: [
      { label: "Loan reference", value: "LND-SAMPLE" },
      { label: "Cycle", value: "Cycle 1" },
      { label: "Payment method", value: "BANK" },
      { label: "Principal outstanding", value: "TSh 1,000,000", strong: true },
    ],
    highlight: { label: "Amount received", value: "TSh 150,000" },
    footerNote: "Sample document — the figures are made up.",
    tagline: "Borrow with confidence. Repay with ease.",
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="Branding-Sample.pdf"',
    },
  });
}
