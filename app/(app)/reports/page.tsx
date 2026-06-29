import { prisma } from '@/lib/db';
import { formatTZS, money, sum } from '@/lib/money';
import { fmtDate } from '@/lib/dates';

export default async function ReportsPage() {
  const [loans, payments] = await Promise.all([
    prisma.loan.findMany({
      include: { customer: { select: { fullName: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.findMany({ orderBy: { paidAt: 'desc' }, take: 1 }),
  ]);

  const now = new Date();
  type Bucket = { label: string; count: number; principalOutstanding: ReturnType<typeof money> };
  const buckets: Bucket[] = [
    { label: 'Current (not yet due)', count: 0, principalOutstanding: money(0) },
    { label: '1–30 days overdue', count: 0, principalOutstanding: money(0) },
    { label: '31–60 days overdue', count: 0, principalOutstanding: money(0) },
    { label: '61–90 days overdue', count: 0, principalOutstanding: money(0) },
    { label: '90+ days overdue', count: 0, principalOutstanding: money(0) },
  ];

  for (const l of loans) {
    if (l.status === 'SETTLED' || l.status === 'WRITTEN_OFF') continue;
    const principalPaid = sum(l.payments.map((p) => p.principalPortion as unknown as string));
    const principalOutstanding = money(l.principal as unknown as string).minus(principalPaid);
    const overdueDays = Math.max(0, Math.floor((now.getTime() - l.dueAt.getTime()) / (1000 * 60 * 60 * 24)));
    let idx = 0;
    if (overdueDays === 0) idx = 0;
    else if (overdueDays <= 30) idx = 1;
    else if (overdueDays <= 60) idx = 2;
    else if (overdueDays <= 90) idx = 3;
    else idx = 4;
    buckets[idx].count++;
    buckets[idx].principalOutstanding = buckets[idx].principalOutstanding.plus(principalOutstanding);
  }

  // Officer performance: loans issued and total disbursed per user
  const officerStats = await prisma.loan.groupBy({
    by: ['issuedById'],
    _sum: { principal: true },
    _count: { _all: true },
  });
  const officerIds = officerStats.map((s) => s.issuedById);
  const officerUsers = await prisma.user.findMany({ where: { id: { in: officerIds } } });
  const officerName: Record<string, string> = Object.fromEntries(officerUsers.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Aging report</h2>
        <table className="table">
          <thead><tr><th>Bucket</th><th>Loans</th><th>Principal outstanding</th></tr></thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{b.count}</td>
                <td>{formatTZS(b.principalOutstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Officer performance</h2>
        <table className="table">
          <thead><tr><th>Officer</th><th>Loans</th><th>Total disbursed</th></tr></thead>
          <tbody>
            {officerStats.map((s) => (
              <tr key={s.issuedById}>
                <td>{officerName[s.issuedById] ?? s.issuedById}</td>
                <td>{s._count._all}</td>
                <td>{formatTZS((s._sum.principal as unknown as string) ?? 0)}</td>
              </tr>
            ))}
            {officerStats.length === 0 && (
              <tr><td colSpan={3} className="text-center text-slate-500 py-6">No loans issued yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Loan ledger</h2>
        <table className="table">
          <thead><tr><th>Customer</th><th>Disbursed</th><th>Principal</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
          <tbody>
            {loans.map((l) => {
              const principalPaid = sum(l.payments.map((p) => p.principalPortion as unknown as string));
              const outstanding = money(l.principal as unknown as string).minus(principalPaid);
              return (
                <tr key={l.id}>
                  <td>{l.customer.fullName}</td>
                  <td>{fmtDate(l.disbursedAt)}</td>
                  <td>{formatTZS(l.principal as unknown as string)}</td>
                  <td>{formatTZS(sum(l.payments.map((p) => p.amount as unknown as string)))}</td>
                  <td>{formatTZS(outstanding)}</td>
                  <td><span className="badge-slate">{l.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
