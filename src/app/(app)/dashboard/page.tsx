import Link from "next/link";
import { Plus, Banknote, Receipt, Users } from "lucide-react";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { add, formatTZS, money } from "@/lib/money";
import { formatDate, startOfTodayUtc, addBusinessDays } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PunctualityBadge, LoanStatusBadge } from "@/components/status";

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <CardContent className="pt-6">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </CardContent>
  );
  return (
    <Card className={href ? "transition-colors hover:bg-accent" : undefined}>
      {href ? <Link href={href}>{inner}</Link> : inner}
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const canWrite = WRITE_ROLES.includes(user.role);

  const today = startOfTodayUtc();
  const in7 = addBusinessDays(today, 7);
  // Start of "this week" = Monday 00:00 UTC.
  const dayOfWeek = today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1;
  const startOfWeek = addBusinessDays(today, -dayOfWeek);

  const [
    activeLoans,
    overdueLoans,
    defaultedLoans,
    customerCount,
    activeAndOverdueLoans,
    upcomingInstallments,
    overdueInstallments,
    recentPayments,
    weekCollectedAgg,
    monthCollectedAgg,
  ] = await Promise.all([
    db.loan.count({ where: { status: "ACTIVE" } }),
    db.loan.count({ where: { status: "OVERDUE" } }),
    db.loan.count({ where: { status: "DEFAULTED" } }),
    db.customer.count(),
    db.loan.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      select: {
        id: true,
        principal: true,
        status: true,
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: { select: { amount: true, installmentId: true } },
      },
    }),
    db.installment.findMany({
      where: {
        status: { in: ["PENDING", "INTEREST_PAID"] },
        dueDate: { gte: today, lte: in7 },
      },
      orderBy: { dueDate: "asc" },
      take: 10,
      include: {
        loan: {
          select: { id: true, customer: { select: { fullName: true } } },
        },
      },
    }),
    db.installment.findMany({
      where: { status: "OVERDUE" },
      orderBy: { dueDate: "asc" },
      take: 10,
      include: {
        loan: {
          select: { id: true, customer: { select: { fullName: true } } },
        },
      },
    }),
    db.payment.findMany({
      orderBy: { paidAt: "desc" },
      take: 5,
      include: {
        loan: {
          select: { id: true, customer: { select: { fullName: true } } },
        },
        installment: { select: { dueDate: true, cycleNumber: true } },
      },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { paidAt: { gte: startOfWeek } },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: {
        paidAt: { gte: new Date(today.getUTCFullYear(), today.getUTCMonth(), 1) },
      },
    }),
  ]);

  let outstanding = money(0);
  for (const loan of activeAndOverdueLoans) {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      installments: loan.installments,
      payments: loan.payments.map((p) => ({
        amount: p.amount,
        installmentId: p.installmentId,
      })),
    });
    outstanding = outstanding.plus(state.principalOutstanding);
  }

  return (
    <>
      <PageHeader
        title={`Welcome${user.name ? `, ${user.name}` : ""}`}
        description="Overview of your portfolio."
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/customers/new">
                  <Users className="size-4" /> Customer
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/loans/new">
                  <Plus className="size-4" /> Issue loan
                </Link>
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Active loans"
          value={activeLoans.toString()}
          href="/loans?status=ACTIVE"
        />
        <Stat
          label="Principal outstanding"
          value={formatTZS(outstanding)}
        />
        <Stat
          label="Overdue / defaulted"
          value={(overdueLoans + defaultedLoans).toString()}
          href="/loans?status=OVERDUE"
        />
        <Stat
          label="Collected this week"
          value={formatTZS(weekCollectedAgg._sum.amount?.toString() ?? "0")}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Customers" value={customerCount.toString()} href="/customers" />
        <Stat
          label="Collected this month"
          value={formatTZS(monthCollectedAgg._sum.amount?.toString() ?? "0")}
        />
        <Stat
          label="Defaulted loans"
          value={defaultedLoans.toString()}
          href="/loans?status=DEFAULTED"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-4" /> Due in the next 7 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingInstallments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing due in the next 7 days.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcomingInstallments.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/loans/${i.loan.id}`}
                      className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-accent"
                    >
                      <div>
                        <div className="font-medium">{i.loan.customer.fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          Cycle {i.cycleNumber} · due {formatDate(i.dueDate)}
                        </div>
                      </div>
                      <span className="text-sm font-medium">
                        {formatTZS(i.expectedInterest.toString())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LoanStatusBadge status="OVERDUE" /> Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overdueInstallments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No overdue installments. Nice.
              </p>
            ) : (
              <ul className="space-y-2">
                {overdueInstallments.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/loans/${i.loan.id}`}
                      className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm hover:bg-destructive/10"
                    >
                      <div>
                        <div className="font-medium">{i.loan.customer.fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          Cycle {i.cycleNumber} · was due {formatDate(i.dueDate)}
                        </div>
                      </div>
                      <span className="text-sm font-medium">
                        {formatTZS(i.expectedInterest.toString())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-4" /> Recent payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No payments recorded yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentPayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/loans/${p.loan.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.loan.customer.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(p.paidAt)} · {p.method}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PunctualityBadge
                        paidAt={p.paidAt}
                        dueDate={p.installment?.dueDate ?? null}
                      />
                      <span className="font-medium">
                        {formatTZS(p.amount.toString())}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
