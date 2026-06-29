import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/rbac";
import { getPaymentsLedger } from "@/lib/queries/payments";
import { toCsv, csvResponse } from "@/lib/csv";
import { toIsoDate, formatDateTime } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = req.nextUrl;
  const payments = await getPaymentsLedger(
    {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      method: searchParams.get("method") ?? undefined,
    },
    10000,
  );

  const csv = toCsv(
    ["Date", "Customer", "Phone", "Amount (TZS)", "Method", "Reference", "Recorded by"],
    payments.map((p) => [
      formatDateTime(p.paidAt, "yyyy-MM-dd HH:mm"),
      p.loan.customer.fullName,
      p.loan.customer.phone,
      p.amount.toFixed(2),
      p.method,
      p.reference ?? "",
      p.recordedBy.name,
    ]),
  );

  return csvResponse(`payments-${toIsoDate(new Date())}.csv`, csv);
}
