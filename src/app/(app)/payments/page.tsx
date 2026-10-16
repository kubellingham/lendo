import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { getPaymentsLedger } from "@/lib/queries/payments";
import { formatDateTime } from "@/lib/dates";
import { formatTZS, add } from "@/lib/money";
import { fmtMoney, fmtPhone, isDemo } from "@/lib/demo-mode";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PaymentsTable,
  type PaymentRow,
} from "@/components/payments/payments-table";
import { PaymentMethod } from "@/generated/prisma/enums";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; method?: string }>;
}) {
  const user = await requireUser();
  const demo = isDemo(user);
  const sp = await searchParams;

  const payments = await getPaymentsLedger(sp);
  const total = add(...payments.map((p) => p.amount.toString()), "0");

  const rows: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    loanId: p.loan.id,
    date: formatDateTime(p.paidAt),
    dateMs: p.paidAt.getTime(),
    customer: p.loan.customer.fullName,
    phone: fmtPhone(p.loan.customer.phone, demo),
    amount: fmtMoney(p.amount.toString(), demo),
    amountNum: Number(p.amount.toString()),
    method: p.method,
    reference: demo ? "•••••" : (p.reference ?? "—"),
    recordedBy: p.recordedBy.name,
  }));

  const exportQs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <>
      <PageHeader
        title="Payments"
        description="All recorded repayments across the portfolio."
        action={
          <Button asChild variant="outline">
            <Link href={`/payments/export${exportQs ? `?${exportQs}` : ""}`}>
              <Download className="size-4" /> Export CSV
            </Link>
          </Button>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Method</label>
          <select
            name="method"
            defaultValue={sp.method ?? ""}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {Object.values(PaymentMethod).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {(sp.from || sp.to || sp.method) && (
          <Button asChild type="button" size="sm" variant="ghost">
            <Link href="/payments">Clear</Link>
          </Button>
        )}
      </form>

      <Card className="mb-4">
        <CardContent className="flex items-center justify-between py-4">
          <span className="text-sm text-muted-foreground">
            {rows.length} payment{rows.length === 1 ? "" : "s"}
          </span>
          <span className="text-lg font-semibold">{fmtMoney(total, demo)}</span>
        </CardContent>
      </Card>

      <PaymentsTable rows={rows} />
    </>
  );
}
