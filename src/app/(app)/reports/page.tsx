import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { formatTZS, money } from "@/lib/money";
import { formatDate, parseIsoDate, startOfTodayUtc } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoanStatusBadge } from "@/components/status";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

const BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: "Current", min: -Infinity, max: 0 },
  { label: "1–30 days late", min: 1, max: 30 },
  { label: "31–60 days late", min: 31, max: 60 },
  { label: "61–90 days late", min: 61, max: 90 },
  { label: "90+ days late", min: 91, max: null },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const from = sp.from ? parseIsoDate(sp.from) : undefined;
  const to = sp.to ? parseIsoDate(sp.to) : undefined;

  const [loans, allPayments, paymentsRanged, monthCollected] = await Promise.all([
    db.loan.findMany({
      where: from || to ? { disbursedAt: { gte: from, lte: to } } : undefined,
      include: {
        customer: { select: { id: true, fullName: true } },
        issuedBy: { select: { name: true } },
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: {
          select: {
            amount: true,
            installmentId: true,
            paidAt: true,
            installment: { select: { dueDate: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.payment.aggregate({ _sum: { amount: true } }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: from || to ? { paidAt: { gte: from, lte: to } } : undefined,
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: {
        paidAt: {
          gte: new Date(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            1,
          ),
        },
      },
    }),
  ]);

  const today = startOfTodayUtc();
  let totalDisbursed = money(0);
  let totalInterestCollected = money(0);
  let totalPrincipalCollected = money(0);
  let totalOutstanding = money(0);
  let onTimeCount = 0;
  let punctualityCount = 0;
  const agingBuckets = BUCKETS.map((b) => ({ ...b, count: 0, amount: money(0) }));

  const rows: {
    id: string;
    customerId: string;
    customer: string;
    principal: string;
    paid: string;
    outstanding: string;
    disbursedAt: Date;
    dueAt: Date;
    status: typeof loans[number]["status"];
    officer: string;
  }[] = [];

  for (const loan of loans) {
    totalDisbursed = totalDisbursed.plus(money(loan.principal));
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount,
        installmentId: p.installmentId,
      })),
    });
    totalInterestCollected = totalInterestCollected.plus(state.interestCollected);
    totalPrincipalCollected = totalPrincipalCollected.plus(state.principalCollected);
    if (loan.status !== "SETTLED" && loan.status !== "WRITTEN_OFF") {
      totalOutstanding = totalOutstanding.plus(state.principalOutstanding);
    }

    for (const p of loan.payments) {
      if (!p.installment) continue;
      const msPerDay = 24 * 60 * 60 * 1000;
      const diff = Math.round(
        (Date.UTC(
          p.paidAt.getUTCFullYear(),
          p.paidAt.getUTCMonth(),
          p.paidAt.getUTCDate(),
        ) -
          Date.UTC(
            p.installment.dueDate.getUTCFullYear(),
            p.installment.dueDate.getUTCMonth(),
            p.installment.dueDate.getUTCDate(),
          )) /
          msPerDay,
      );
      punctualityCount++;
      if (diff <= 0) onTimeCount++;
    }

    let daysLate = 0;
    if (loan.status !== "SETTLED" && loan.status !== "WRITTEN_OFF") {
      const overdueInst = loan.installments.find((i) => i.status === "OVERDUE");
      if (overdueInst) {
        daysLate = Math.max(
          0,
          Math.floor(
            (today.getTime() - overdueInst.dueDate.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );
      }
      const bucket =
        agingBuckets.find(
          (b) =>
            (b.min === -Infinity || daysLate >= b.min) &&
            (b.max === null || daysLate <= b.max),
        ) ?? agingBuckets[0];
      bucket.count++;
      bucket.amount = bucket.amount.plus(state.principalOutstanding);
    }

    rows.push({
      id: loan.id,
      customerId: loan.customer.id,
      customer: loan.customer.fullName,
      principal: loan.principal.toString(),
      paid: state.totalCollected.toString(),
      outstanding: state.principalOutstanding.toString(),
      disbursedAt: loan.disbursedAt,
      dueAt: loan.dueAt,
      status: loan.status,
      officer: loan.issuedBy.name,
    });
  }

  const defaultedCount = loans.filter((l) => l.status === "DEFAULTED").length;
  const defaultRate = loans.length
    ? ((defaultedCount / loans.length) * 100).toFixed(1) + "%"
    : "—";
  const onTimeRate = punctualityCount
    ? ((onTimeCount / punctualityCount) * 100).toFixed(1) + "%"
    : "—";

  const exportQs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <>
      <PageHeader
        title="Reports"
        description="Portfolio health, aging, and the loan ledger."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/loans/export${exportQs ? `?${exportQs}` : ""}`}>
              <Download className="size-4" /> Export loans CSV
            </Link>
          </Button>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Disbursed from</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Disbursed to</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {(sp.from || sp.to) && (
          <Button asChild type="button" size="sm" variant="ghost">
            <Link href="/reports">Clear</Link>
          </Button>
        )}
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total disbursed" value={formatTZS(totalDisbursed)} />
        <Stat
          label="Interest collected"
          value={formatTZS(totalInterestCollected)}
        />
        <Stat
          label="Principal outstanding"
          value={formatTZS(totalOutstanding)}
        />
        <Stat label="Default rate" value={defaultRate} />
        <Stat
          label="Total collected (lifetime)"
          value={formatTZS(allPayments._sum.amount?.toString() ?? "0")}
        />
        <Stat
          label="Collected this month"
          value={formatTZS(monthCollected._sum.amount?.toString() ?? "0")}
        />
        <Stat
          label="Collected (filter range)"
          value={formatTZS(paymentsRanged._sum.amount?.toString() ?? "0")}
        />
        <Stat label="On-time rate" value={onTimeRate} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Aging</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Loans</TableHead>
                <TableHead className="text-right">Principal outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingBuckets.map((b) => (
                <TableRow key={b.label}>
                  <TableCell>{b.label}</TableCell>
                  <TableCell className="text-right">{b.count}</TableCell>
                  <TableCell className="text-right">
                    {formatTZS(b.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Loan ledger ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Disbursed</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Officer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/loans/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.customer}
                      </Link>
                    </TableCell>
                    <TableCell>{formatTZS(r.principal)}</TableCell>
                    <TableCell>{formatTZS(r.paid)}</TableCell>
                    <TableCell>{formatTZS(r.outstanding)}</TableCell>
                    <TableCell>{formatDate(r.disbursedAt)}</TableCell>
                    <TableCell>{formatDate(r.dueAt)}</TableCell>
                    <TableCell>
                      <LoanStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.officer}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No loans match the current filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
