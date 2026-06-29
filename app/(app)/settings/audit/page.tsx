import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/rbac';
import { fmtDateTime } from '@/lib/dates';

export default async function AuditPage() {
  await requireUser();
  const logs = await prisma.auditLog.findMany({
    orderBy: { at: 'desc' },
    take: 200,
    include: { actor: { select: { name: true } } },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
      <div className="card">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Entity id</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{fmtDateTime(l.at)}</td>
                <td>{l.actor?.name ?? '—'}</td>
                <td><span className="badge-slate">{l.action}</span></td>
                <td>{l.entity}</td>
                <td className="text-xs text-slate-500">{l.entityId}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-6">No log entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
