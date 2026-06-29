import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/rbac';
import { fmtDateTime } from '@/lib/dates';
import { templateNames } from '@/lib/whatsapp';

export default async function WhatsAppSettingsPage() {
  await requireUser();
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { customer: { select: { fullName: true, phone: true } } },
  });
  const counts = {
    queued: notifications.filter((n) => n.status === 'QUEUED').length,
    sent: notifications.filter((n) => n.status === 'SENT').length,
    failed: notifications.filter((n) => n.status === 'FAILED').length,
  };
  const provider = process.env.TWILIO_ACCOUNT_SID ? 'Twilio (configured)' : 'Twilio (NOT configured — messages logged to console)';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>

      <section className="card p-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Provider" value={provider} />
        <Kpi title="Queued" value={counts.queued.toString()} />
        <Kpi title="Sent (last 100)" value={counts.sent.toString()} />
        <Kpi title="Failed (last 100)" value={counts.failed.toString()} />
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-2">Templates</h2>
        <ul className="list-disc list-inside text-sm text-slate-700">
          {templateNames.map((t) => <li key={t}><code>{t}</code></li>)}
        </ul>
        <p className="text-xs text-slate-500 mt-2">Templates can be customised in <code>lib/whatsapp.ts</code>.</p>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Recent notifications</h2>
        <table className="table">
          <thead><tr><th>Created</th><th>Customer</th><th>Phone</th><th>Template</th><th>Status</th><th>Provider id / error</th></tr></thead>
          <tbody>
            {notifications.map((n) => (
              <tr key={n.id}>
                <td>{fmtDateTime(n.createdAt)}</td>
                <td>{n.customer.fullName}</td>
                <td>{n.customer.phone}</td>
                <td>{n.template}</td>
                <td><span className={
                  n.status === 'SENT' ? 'badge-green' :
                  n.status === 'FAILED' ? 'badge-red' : 'badge-slate'
                }>{n.status}</span></td>
                <td className="text-xs">{n.providerMessageId || n.error || '—'}</td>
              </tr>
            ))}
            {notifications.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-6">No notifications yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
