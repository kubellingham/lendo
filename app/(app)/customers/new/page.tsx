import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/rbac';
import { canEditCustomers } from '@/lib/rbac';
import { audit } from '@/lib/audit';

const customerSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  fullName: z.string().min(2),
  businessName: z.string().optional().nullable(),
  nationalIdNumber: z.string().optional().nullable(),
  phone: z.string().min(7),
  altPhone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  addressLine: z.string().min(2),
  city: z.string().min(1),
  region: z.string().min(1),
  occupation: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  businessTin: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (!canEditCustomers(user.role)) {
    return <div className="card p-6 text-red-700">You don't have permission to create customers.</div>;
  }

  async function createCustomer(formData: FormData) {
    'use server';
    const me = await requireUser();
    if (!canEditCustomers(me.role)) throw new Error('Forbidden');
    const raw = Object.fromEntries(formData.entries());
    const parsed = customerSchema.safeParse({
      ...raw,
      email: raw.email === '' ? null : raw.email,
    });
    if (!parsed.success) {
      throw new Error('Invalid input: ' + parsed.error.message);
    }
    const data = parsed.data;
    const created = await prisma.customer.create({
      data: {
        ...data,
        email: data.email || null,
        businessName: data.businessName || null,
        nationalIdNumber: data.nationalIdNumber || null,
        altPhone: data.altPhone || null,
        occupation: data.occupation || null,
        employer: data.employer || null,
        businessTin: data.businessTin || null,
        notes: data.notes || null,
        createdById: me.id,
      },
    });
    await audit({ actorId: me.id, action: 'create', entity: 'Customer', entityId: created.id, after: created });
    redirect(`/customers/${created.id}`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">New customer</h1>
      <form action={createCustomer} className="card p-6 space-y-4 max-w-3xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Type</label>
            <select name="type" className="select" defaultValue="INDIVIDUAL">
              <option value="INDIVIDUAL">Individual</option>
              <option value="BUSINESS">Business</option>
            </select>
          </div>
          <div>
            <label className="label">Full name</label>
            <input className="input" name="fullName" required />
          </div>
          <div>
            <label className="label">Business name (if business)</label>
            <input className="input" name="businessName" />
          </div>
          <div>
            <label className="label">National ID</label>
            <input className="input" name="nationalIdNumber" />
          </div>
          <div>
            <label className="label">Phone (E.164)</label>
            <input className="input" name="phone" placeholder="+2557..." required />
          </div>
          <div>
            <label className="label">Alt phone</label>
            <input className="input" name="altPhone" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" name="email" type="email" />
          </div>
          <div>
            <label className="label">Occupation / role</label>
            <input className="input" name="occupation" />
          </div>
          <div>
            <label className="label">Employer</label>
            <input className="input" name="employer" />
          </div>
          <div>
            <label className="label">Business TIN</label>
            <input className="input" name="businessTin" />
          </div>
          <div className="col-span-2">
            <label className="label">Address line</label>
            <input className="input" name="addressLine" required />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" name="city" required defaultValue="Dar es Salaam" />
          </div>
          <div>
            <label className="label">Region</label>
            <input className="input" name="region" required defaultValue="Dar es Salaam" />
          </div>
          <div className="col-span-2">
            <label className="label">Notes</label>
            <textarea name="notes" className="textarea" rows={3} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <a href="/customers" className="btn-secondary">Cancel</a>
          <button type="submit" className="btn-primary">Create customer</button>
        </div>
      </form>
    </div>
  );
}
