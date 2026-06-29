import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signIn } from '@/lib/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  const sp = await searchParams;

  async function loginAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const from = String(formData.get('from') ?? '/dashboard');
    await signIn('credentials', { email, password, redirectTo: from || '/dashboard' });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6">
        <div className="mb-6">
          <Link href="/" className="text-2xl font-bold tracking-tight">Lendo</Link>
          <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
        </div>
        {sp.error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            Invalid email or password.
          </div>
        )}
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="from" value={sp.from ?? '/dashboard'} />
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoFocus className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required className="input" />
          </div>
          <button type="submit" className="btn-primary w-full">Sign in</button>
        </form>
      </div>
    </div>
  );
}
