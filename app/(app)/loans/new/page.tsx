import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser, canIssueLoans } from '@/lib/rbac';
import { generateSchedule, loanDueDate } from '@/lib/schedule';
import { money } from '@/lib/money';
import { audit } from '@/lib/audit';

const schema = z.object({
  customerId: z.string().min(1),
  principal: z.coerce.number().positive(),
  disbursedAt: z.string().min(1),
  notes: z.string().optional().nullable(),
  acknowledgeBlacklist: z.string().optional(),
});

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  if (!canIssueLoans(user.role)) {
    return <div className="card p-6 text-red-700">You don't have permission to issue loans.</div>;
  }
  const sp = await searchParams;
  const customers = await prisma.customer.findMany({
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, phone: true, isFlagged: true },
    take: 1000,
  });

  let preselected: { id: string; fullName: string; isFlagged: boolean } | null = null;
  let hasBlacklist = false;
  if (sp.customerId) {
    const c = await prisma.customer.findUnique({
      where: { id: sp.customerId },
      include: { flags: { where: { severity: 'BLACKLIST' }, take: 1 } },
    });
    if (c) {
      preselected = { id: c.id, fullName: c.fullName, isFlagged: c.isFlagged };
      hasBlacklist = c.flags.length > 0;
    }
  }

  async function createLoan(formData: FormData) {
    'use server';
    const me = await requireUser();
    if (!canIssueLoans(me.role)) throw new Error('Forbidden');
    const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) throw new Error('Invalid input: ' + parsed.error.message);
    const { customerId, principal, disbursedAt, notes, acknowledgeBlacklist } = parsed.data;

    const c = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { flags: { where: { severity: 'BLACKLIST' }, take: 1 } },
    });
    if (!c) throw new Error('Customer not found');

    const blacklisted = c.flags.length > 0;
    if (blacklisted && me.role !== 'ADMIN') {
      throw new Error('Customer is BLACKLISTED — only an ADMIN can issue loans to them.');
    }
    if (blacklisted && acknowledgeBlacklist !== 'YES') {
      throw new Error('Admin override required: type YES in the override field to confirm.');
    }

    const disbursed = new Date(disbursedAt + 'T00:00:00Z');
    const dueAt = loanDueDate({ principal, disbursedAt: disbursed });
    const schedule = generateSchedule({ principal, disbursedAt: disbursed });

    const loan = await prisma.$transaction(async (tx) => {
      const created = await tx.loan.create({
        data: {
          customerId,
          principal: money(principal).toFixed(2),
          interestRatePct: '15.00',
          cyclesAllowed: 3,
          cycleDays: 30,
          disbursedAt: disbursed,
          dueAt,
          status: 'ACTIVE',
          issuedById: me.id,
          notes: notes || null,
        },
      });
      await tx.installment.createMany({
        data: schedule.map((s) => ({
          loanId: created.id,
          cycleNumber: s.cycleNumber,
          dueDate: s.dueDate,
          expectedInterest: s.expectedInterest.toFixed(2),
          expectedPrincipalAtThisCycle: s.expectedPrincipalAtThisCycle.toFixed(2),
        })),
      });
      return created;
    });

    await audit({
      actorId: me.id,
      action: blacklisted ? 'issue_loan_blacklist_override' : 'issue_loan',
      entity: 'Loan',
      entityId: loan.id,
      after: { customerId, principal, disbursedAt },
    });

    redirect(`/loans/${loan.id}`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">New loan</h1>
      <form action={createLoan} className="card p-6 space-y-4 max-w-2xl">
        <div>
          <label className="label">Customer</label>
          <select name="customerId" className="select" required defaultValue={preselected?.id ?? ''}>
            <option value="">Select a customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} — {c.phone}{c.isFlagged ? ' (FLAGGED)' : ''}
              </option>
            ))}
          </select>
        </div>
        {hasBlacklist && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            ⚠️ This customer is BLACKLISTED. Only an ADMIN can issue loans, and an override is required.
            {user.role === 'ADMIN' && (
              <div className="mt-2">
                <label className="label">Type YES to override</label>
                <input name="acknowledgeBlacklist" className="input max-w-xs" placeholder="YES" />
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Principal (TZS)</label>
            <input name="principal" type="number" min="1" step="1" required className="input" placeholder="100000" />
          </div>
          <div>
            <label className="label">Disbursed on</label>
            <input name="disbursedAt" type="date" required className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
        </div>
        <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm text-slate-600">
          <div className="font-medium text-slate-800 mb-1">Lendo terms (fixed)</div>
          15% per 30-day cycle on principal. Customer may pay interest-only at day 30 or 60 and roll forward.
          Full settlement is mandatory at day 90. Max repayment: principal + 45%.
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="textarea" rows={2} />
        </div>
        <div className="flex gap-2 justify-end">
          <a href="/loans" className="btn-secondary">Cancel</a>
          <button type="submit" className="btn-primary">Issue loan</button>
        </div>
      </form>
    </div>
  );
}
