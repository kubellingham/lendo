import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDate } from '@/lib/dates';
import { formatTZS } from '@/lib/money';
import type { LoanStatus } from '@prisma/client';

const statusList: LoanStatus[] = ['ACTIVE', 'OVERDUE', 'SETTLED', 'DEFAULTED', 'WRITTEN_OFF'];

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = (statusList as string[]).includes(sp.status ?? '') ? (sp.status as LoanStatus) : undefined;
  const q = sp.q?.trim();

  const loans = await prisma.loan.findMany({
    where: {
      AND: [
        status ? { status } : {},
        q
          ? {
              customer: {
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {},
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { customer: { select: { fullName: true } }, issuedBy: { select: { name: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Loans</h1>
        <Link href="/loans/new" className="btn-primary">+ New loan</Link>
      </div>

      <form className="flex gap-2 items-center">
        <input name="q" defaultValue={q ?? ''} placeholder="Search by customer..." className="input max-w-sm" />
        <select name="status" defaultValue={status ?? ''} className="select max-w-[12rem]">
          <option value="">All statuses</option>
          {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Principal</th>
              <th>Disbursed</th>
              <th>Due</th>
              <th>Status</th>
              <th>Officer</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/loans/${l.id}`} className="hover:underline font-medium">{l.customer.fullName}</Link></td>
                <td>{formatTZS(l.principal as unknown as string)}</td>
                <td>{fmtDate(l.disbursedAt)}</td>
                <td>{fmtDate(l.dueAt)}</td>
                <td><span className="badge-slate">{l.status}</span></td>
                <td className="text-xs text-slate-500">{l.issuedBy.name}</td>
              </tr>
            ))}
            {loans.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-8">No loans found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
