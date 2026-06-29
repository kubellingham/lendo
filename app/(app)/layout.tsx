import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/lib/auth';
import {
  LayoutDashboard,
  Users,
  Banknote,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/customers', label: 'Customers', Icon: Users },
  { href: '/loans', label: 'Loans', Icon: Banknote },
  { href: '/payments', label: 'Payments', Icon: Wallet },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <Link href="/dashboard" className="text-xl font-bold tracking-tight">Lendo</Link>
          <p className="text-xs text-slate-500 mt-0.5">Lending mgmt &middot; TZS</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {nav.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md text-slate-700 hover:bg-slate-100"
            >
              <Icon className="size-4 text-slate-500" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs">
          <div className="font-medium text-slate-900">{session.user.name}</div>
          <div className="text-slate-500">{session.user.email}</div>
          <div className="text-slate-500 mt-1">Role: <span className="badge-slate">{session.user.role}</span></div>
          <form action={signOutAction} className="mt-3">
            <button type="submit" className="btn-secondary w-full">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
