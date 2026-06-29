import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, canEditCustomers } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { formatTZS } from '@/lib/money';
import { revalidatePath } from 'next/cache';

export default async function CustomerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      loans: { orderBy: { createdAt: 'desc' } },
      flags: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } } },
    },
  });
  if (!customer) notFound();

  async function addFlag(formData: FormData) {
    'use server';
    const me = await requireUser();
    if (!canEditCustomers(me.role)) throw new Error('Forbidden');
    const reason = String(formData.get('reason') ?? '').trim();
    const severity = String(formData.get('severity') ?? 'LOW') as
      | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLACKLIST';
    if (!reason) return;
    const created = await prisma.customerFlag.create({
      data: { customerId: id, reason, severity, createdById: me.id },
    });
    const isFlagged = severity !== 'LOW' ? true : customer!.isFlagged;
    await prisma.customer.update({
      where: { id },
      data: { isFlagged, flagReason: reason },
    });
    await audit({ actorId: me.id, action: 'flag', entity: 'Customer', entityId: id, after: created });
    revalidatePath(`/customers/${id}`);
  }

  async function clearFlag() {
    'use server';
    const me = await requireUser();
    if (!canEditCustomers(me.role)) throw new Error('Forbidden');
    await prisma.customer.update({ where: { id }, data: { isFlagged: false, flagReason: null } });
    await audit({ actorId: me.id, action: 'unflag', entity: 'Customer', entityId: id });
    revalidatePath(`/customers/${id}`);
  }

  const blacklist = customer.flags.find((f) => f.severity === 'BLACKLIST');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{customer.fullName}</h1>
          <div className="text-sm text-slate-500">
            {customer.type === 'BUSINESS' && customer.businessName ? customer.businessName + ' · ' : ''}
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
          </div>
          {customer.isFlagged && (
            <div className="mt-2">
              <span className="badge-red">Flagged</span>
              {customer.flagReason && <span className="ml-2 text-sm text-red-700">{customer.flagReason}</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!blacklist && (
            <Link href={`/loans/new?customerId=${customer.id}`} className="btn-primary">+ New loan</Link>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="card p-4 lg:col-span-2 space-y-2 text-sm">
          <h2 className="font-semibold mb-2">Details</h2>
          <Row label="Type" value={customer.type} />
          <Row label="National ID" value={customer.nationalIdNumber || '—'} />
          <Row label="Alt phone" value={customer.altPhone || '—'} />
          <Row label="Address" value={`${customer.addressLine}, ${customer.city}, ${customer.region}`} />
          <Row label="Occupation" value={customer.occupation || '—'} />
          <Row label="Employer" value={customer.employer || '—'} />
          <Row label="Business TIN" value={customer.businessTin || '—'} />
          <Row label="Notes" value={customer.notes || '—'} />
          <Row label="Added" value={fmtDateTime(customer.createdAt)} />
        </section>

        <section className="card p-4">
          <h2 className="font-semibold mb-3">Risk flags</h2>
          {canEditCustomers(user.role) && (
            <form action={addFlag} className="space-y-2 mb-4">
              <div>
                <label className="label">Reason</label>
                <input name="reason" className="input" placeholder="e.g. Missed last payment" />
              </div>
              <div>
                <label className="label">Severity</label>
                <select name="severity" className="select">
                  <option value="LOW">Low (note only)</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="BLACKLIST">Blacklist (block loans)</option>
                </select>
              </div>
              <button type="submit" className="btn-secondary w-full">Add flag</button>
            </form>
          )}
          {customer.isFlagged && canEditCustomers(user.role) && (
            <form action={clearFlag}><button className="btn-secondary w-full">Clear active flag</button></form>
          )}

          <div className="mt-4 space-y-2 max-h-80 overflow-auto">
            {customer.flags.length === 0 && <div className="text-sm text-slate-500">No flags recorded.</div>}
            {customer.flags.map((f) => (
              <div key={f.id} className="border border-slate-200 rounded-md p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={
                    f.severity === 'BLACKLIST' ? 'badge-red' :
                    f.severity === 'HIGH' ? 'badge-red' :
                    f.severity === 'MEDIUM' ? 'badge-yellow' : 'badge-slate'
                  }>{f.severity}</span>
                  <span className="text-xs text-slate-500">{fmtDateTime(f.createdAt)} · {f.createdBy.name}</span>
                </div>
                <div className="mt-1">{f.reason}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Loans ({customer.loans.length})</h2>
        </div>
        <table className="table">
          <thead><tr><th>Disbursed</th><th>Principal</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {customer.loans.map((l) => (
              <tr key={l.id}>
                <td>{fmtDate(l.disbursedAt)}</td>
                <td>{formatTZS(l.principal as unknown as string)}</td>
                <td>{fmtDate(l.dueAt)}</td>
                <td><span className="badge-slate">{l.status}</span></td>
                <td><Link className="text-blue-600 hover:underline" href={`/loans/${l.id}`}>Open</Link></td>
              </tr>
            ))}
            {customer.loans.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-6">No loans yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex">
      <div className="w-32 text-slate-500">{label}</div>
      <div className="flex-1">{value}</div>
    </div>
  );
}
