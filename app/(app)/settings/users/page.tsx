import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { fmtDateTime } from '@/lib/dates';
import type { Role } from '@prisma/client';

export default async function UsersPage() {
  const me = await requireRole('ADMIN');
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });

  async function createUser(formData: FormData) {
    'use server';
    const admin = await requireRole('ADMIN');
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const role = String(formData.get('role') ?? 'LOAN_OFFICER') as Role;
    const password = String(formData.get('password') ?? '');
    if (!name || !email || !password) throw new Error('Missing fields');
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({ data: { name, email, role, passwordHash } });
    await audit({ actorId: admin.id, action: 'create', entity: 'User', entityId: created.id, after: { name, email, role } });
    revalidatePath('/settings/users');
  }

  async function toggleActive(formData: FormData) {
    'use server';
    const admin = await requireRole('ADMIN');
    const id = String(formData.get('id'));
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.id === admin.id) return;
    await prisma.user.update({ where: { id }, data: { isActive: !u.isActive } });
    await audit({ actorId: admin.id, action: u.isActive ? 'deactivate' : 'activate', entity: 'User', entityId: id });
    revalidatePath('/settings/users');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Staff users</h1>

      <form action={createUser} className="card p-4 grid grid-cols-2 lg:grid-cols-5 gap-3 items-end max-w-5xl">
        <div><label className="label">Name</label><input className="input" name="name" required /></div>
        <div><label className="label">Email</label><input className="input" type="email" name="email" required /></div>
        <div>
          <label className="label">Role</label>
          <select className="select" name="role" defaultValue="LOAN_OFFICER">
            <option value="ADMIN">Admin</option>
            <option value="LOAN_OFFICER">Loan officer</option>
            <option value="ACCOUNTANT">Accountant</option>
          </select>
        </div>
        <div><label className="label">Password</label><input className="input" type="password" name="password" required /></div>
        <button className="btn-primary">Create user</button>
      </form>

      <div className="card">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td><span className="badge-slate">{u.role}</span></td>
                <td>{u.isActive ? <span className="badge-green">Active</span> : <span className="badge-red">Disabled</span>}</td>
                <td>{fmtDateTime(u.createdAt)}</td>
                <td>
                  {u.id !== me.id && (
                    <form action={toggleActive}>
                      <input type="hidden" name="id" value={u.id} />
                      <button className="btn-secondary text-xs">{u.isActive ? 'Deactivate' : 'Activate'}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
