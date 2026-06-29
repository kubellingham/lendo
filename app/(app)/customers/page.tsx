import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDate } from '@/lib/dates';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; flagged?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const flagged = sp.flagged === '1';

  const customers = await prisma.customer.findMany({
    where: {
      AND: [
        flagged ? { isFlagged: true } : {},
        q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { businessName: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { nationalIdNumber: { contains: q } },
              ],
            }
          : {},
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { _count: { select: { loans: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <Link href="/customers/new" className="btn-primary">+ New customer</Link>
      </div>

      <form className="flex gap-2 items-center">
        <input name="q" defaultValue={q ?? ''} placeholder="Search name, phone, ID..." className="input max-w-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="flagged" value="1" defaultChecked={flagged} /> Flagged only
        </label>
        <button className="btn-secondary" type="submit">Search</button>
      </form>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Phone</th>
              <th>City</th>
              <th>Loans</th>
              <th>Flagged</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                    {c.fullName}
                  </Link>
                  {c.businessName && <div className="text-xs text-slate-500">{c.businessName}</div>}
                </td>
                <td><span className="badge-slate">{c.type}</span></td>
                <td>{c.phone}</td>
                <td>{c.city}</td>
                <td>{c._count.loans}</td>
                <td>{c.isFlagged ? <span className="badge-red">Flagged</span> : <span className="text-slate-400">—</span>}</td>
                <td>{fmtDate(c.createdAt)}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-500 py-8">No customers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
