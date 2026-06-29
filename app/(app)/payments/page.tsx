import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDateTime } from '@/lib/dates';
import { formatTZS, sum } from '@/lib/money';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; method?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const from = sp.from ? new Date(sp.from + 'T00:00:00Z') : undefined;
  const to = sp.to ? new Date(sp.to + 'T23:59:59Z') : undefined;
  const method = sp.method || undefined;

  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: from, lte: to },
      method: method ? (method as 'CASH' | 'MPESA' | 'BANK' | 'OTHER') : undefined,
      ...(q
        ? {
            loan: {
              customer: {
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q } },
                ],
              },
            },
          }
        : {}),
    },
    orderBy: { paidAt: 'desc' },
    take: 500,
    include: {
      loan: { include: { customer: { select: { id: true, fullName: true } } } },
      recordedBy: { select: { name: true } },
    },
  });

  const totalAmount = sum(payments.map((p) => p.amount as unknown as string));
  const totalInterest = sum(payments.map((p) => p.interestPortion as unknown as string));
  const totalPrincipal = sum(payments.map((p) => p.principalPortion as unknown as string));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <a
          href={`/api/payments/export.csv?${new URLSearchParams({
            q: q ?? '', from: sp.from ?? '', to: sp.to ?? '', method: method ?? '',
          }).toString()}`}
          className="btn-secondary"
        >Export CSV</a>
      </div>

      <form className="flex flex-wrap gap-2 items-end">
        <div><label className="label">Search customer</label><input className="input" name="q" defaultValue={q ?? ''} /></div>
        <div><label className="label">From</label><input className="input" type="date" name="from" defaultValue={sp.from ?? ''} /></div>
        <div><label className="label">To</label><input className="input" type="date" name="to" defaultValue={sp.to ?? ''} /></div>
        <div>
          <label className="label">Method</label>
          <select className="select" name="method" defaultValue={method ?? ''}>
            <option value="">All</option><option>CASH</option><option>MPESA</option><option>BANK</option><option>OTHER</option>
          </select>
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="grid grid-cols-3 gap-4">
        <Kpi title="Total" value={formatTZS(totalAmount)} />
        <Kpi title="Interest collected" value={formatTZS(totalInterest)} />
        <Kpi title="Principal collected" value={formatTZS(totalPrincipal)} />
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Customer</th><th>Amount</th><th>Interest</th><th>Principal</th><th>Method</th><th>Ref</th><th>By</th></tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{fmtDateTime(p.paidAt)}</td>
                <td><Link className="hover:underline" href={`/customers/${p.loan.customer.id}`}>{p.loan.customer.fullName}</Link></td>
                <td className="font-medium">{formatTZS(p.amount as unknown as string)}</td>
                <td>{formatTZS(p.interestPortion as unknown as string)}</td>
                <td>{formatTZS(p.principalPortion as unknown as string)}</td>
                <td>{p.method}</td>
                <td className="text-xs text-slate-500">{p.reference || '—'}</td>
                <td className="text-xs text-slate-500">{p.recordedBy.name}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-500 py-8">No payments found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
