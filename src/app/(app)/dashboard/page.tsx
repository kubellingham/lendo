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
import { Avatar } from "@/components/ui/avatar";

const TONES = {
  default: "border-slate-200 bg-white",
  primary: "border-slate-200 bg-slate-50",
  success: "border-emerald-200 bg-emerald-50",
  danger: "border-red-200 bg-red-50",
} as const;

const VALUE_TONE = {
  default: "text-slate-900",
  primary: "text-slate-900",
  success: "text-emerald-700",
  danger: "text-red-700",
} as const;

function Stat({
  label,
  value,
  sub,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  tone?: keyof typeof TONES;
}) {
  const inner = (
    <div className={`rounded-xl border p-4 sm:p-5 ${TONES[tone]}`}>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className={`stat-value mt-1.5 text-2xl font-semibold ${VALUE_TONE[tone]}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-shadow hover:shadow-sm">
      {inner}
    </Link>
  ) : (
    inner
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
          sub={`${customerCount} customers`}
          href="/loans?status=ACTIVE"
          tone="primary"
        />
        <Stat
          label="Principal outstanding"
          value={formatTZS(outstanding)}
          sub="Across active & overdue loans"
        />
        <Stat
          label="Overdue / defaulted"
          value={(overdueLoans + defaultedLoans).toString()}
          sub={`${defaultedLoans} defaulted`}
          href="/loans?status=OVERDUE"
          tone={overdueLoans + defaultedLoans > 0 ? "danger" : "default"}
        />
        <Stat
          label="Collected this week"
          value={formatTZS(weekCollectedAgg._sum.amount?.toString() ?? "0")}
          sub={`${formatTZS(monthCollectedAgg._sum.amount?.toString() ?? "0")} this month`}
          tone="success"
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
                      className="flex items-center gap-3 rounded-md border p-2 text-sm hover:bg-accent"
                    >
                      <Avatar name={i.loan.customer.fullName} size="sm" />
                      <div className="min-w-0 flex-1">
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
                      className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm hover:bg-destructive/10"
                    >
                      <Avatar name={i.loan.customer.fullName} size="sm" tone="danger" />
                      <div className="min-w-0 flex-1">
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
                    className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm"
                  >
                    <Avatar name={p.loan.customer.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
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
