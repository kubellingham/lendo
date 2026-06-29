import Link from 'next/link';
import { requireUser, canManageUsers } from '@/lib/rbac';

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        {canManageUsers(user.role) && (
          <Link href="/settings/users" className="card p-4 hover:shadow">
            <div className="font-semibold">Staff users</div>
            <div className="text-sm text-slate-500">Manage admin / loan officer / accountant accounts.</div>
          </Link>
        )}
        <Link href="/settings/whatsapp" className="card p-4 hover:shadow">
          <div className="font-semibold">WhatsApp</div>
          <div className="text-sm text-slate-500">View dispatched / failed reminders and templates.</div>
        </Link>
        <Link href="/settings/audit" className="card p-4 hover:shadow">
          <div className="font-semibold">Audit log</div>
          <div className="text-sm text-slate-500">Recent mutations across the system.</div>
        </Link>
      </div>
    </div>
  );
}
