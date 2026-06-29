import { prisma } from '@/lib/db';
import { formatTZS, money, sum } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import Link from 'next/link';

async function getKpis() {
  const [loans, payments, customers, overdueLoans] = await Promise.all([
    prisma.loan.findMany({ select: { principal: true, status: true } }),
    prisma.payment.findMany({ select: { amount: true, principalPortion: true, interestPortion: true } }),
    prisma.customer.count(),
    prisma.loan.count({ where: { status: { in: ['OVERDUE', 'DEFAULTED'] } } }),
  ]);

  const totalDisbursed = sum(loans.map((l) => l.principal as unknown as string));
  const totalCollected = sum(payments.map((p) => p.amount as unknown as string));
  const collectedPrincipal = sum(payments.map((p) => p.principalPortion as unknown as string));
  const collectedInterest = sum(payments.map((p) => p.interestPortion as unknown as string));

  const outstandingPrincipal = totalDisbursed.minus(collectedPrincipal);
  const defaulted = loans.filter((l) => l.status === 'DEFAULTED').length;
  const defaultRate = loans.length === 0 ? 0 : (defaulted / loans.length) * 100;

  return {
    totalDisbursed,
    totalCollected,
    collectedPrincipal,
    collectedInterest,
    outstandingPrincipal,
    overdueLoans,
    customers,
    loansCount: loans.length,
    defaultRate,
  };
}

async function getRecentLoans() {
  return prisma.loan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { customer: { select: { fullName: true } } },
  });
}

async function getUpcomingDue() {
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  return prisma.installment.findMany({
    where: {
      dueDate: { gte: now, lte: in14 },
      status: { in: ['PENDING', 'INTEREST_PAID'] },
    },
    orderBy: { dueDate: 'asc' },
    take: 10,
    include: { loan: { include: { customer: { select: { fullName: true } } } } },
  });
}

export default async function DashboardPage() {
  const [k, recent, upcoming] = await Promise.all([getKpis(), getRecentLoans(), getUpcomingDue()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/customers/new" className="btn-secondary">+ Customer</Link>
          <Link href="/loans/new" className="btn-primary">+ New loan</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Total disbursed" value={formatTZS(k.totalDisbursed)} sub={`${k.loansCount} loans`} />
        <Kpi title="Total collected" value={formatTZS(k.totalCollected)} sub={`Interest ${formatTZS(k.collectedInterest)}`} />
        <Kpi title="Outstanding principal" value={formatTZS(k.outstandingPrincipal)} sub={`${k.overdueLoans} overdue/default`} />
        <Kpi title="Customers" value={k.customers.toString()} sub={`Default rate ${k.defaultRate.toFixed(1)}%`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recent loans</h2>
            <Link href="/loans" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No loans yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Customer</th><th>Principal</th><th>Disbursed</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/loans/${l.id}`} className="hover:underline">{l.customer.fullName}</Link></td>
                    <td>{formatTZS(l.principal as unknown as string)}</td>
                    <td>{fmtDate(l.disbursedAt)}</td>
                    <td><LoanStatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Upcoming due (14d)</h2>
            <Link href="/loans?status=ACTIVE" className="text-sm text-blue-600 hover:underline">All active</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing due in the next 14 days.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Customer</th><th>Cycle</th><th>Due</th><th>Interest</th></tr></thead>
              <tbody>
                {upcoming.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/loans/${i.loanId}`} className="hover:underline">{i.loan.customer.fullName}</Link></td>
                    <td>#{i.cycleNumber}</td>
                    <td>{fmtDate(i.dueDate)}</td>
                    <td>{formatTZS(i.expectedInterest as unknown as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function LoanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'badge-blue',
    SETTLED: 'badge-green',
    OVERDUE: 'badge-yellow',
    DEFAULTED: 'badge-red',
    WRITTEN_OFF: 'badge-slate',
  };
  return <span className={map[status] ?? 'badge-slate'}>{status}</span>;
}
