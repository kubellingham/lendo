import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser, canRecordPayments } from '@/lib/rbac';
import { fmtDate, fmtDateTime, today } from '@/lib/dates';
import { formatTZS, money, sum } from '@/lib/money';
import { audit } from '@/lib/audit';

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const loan = await prisma.loan.findUnique({
    where: { id },
    include: {
      customer: true,
      installments: { orderBy: { cycleNumber: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' }, include: { recordedBy: { select: { name: true } } } },
      issuedBy: { select: { name: true } },
    },
  });
  if (!loan) notFound();

  const principal = money(loan.principal as unknown as string);
  const totalPaid = sum(loan.payments.map((p) => p.amount as unknown as string));
  const interestPaid = sum(loan.payments.map((p) => p.interestPortion as unknown as string));
  const principalPaid = sum(loan.payments.map((p) => p.principalPortion as unknown as string));
  const principalOutstanding = principal.minus(principalPaid).clampedTo(0, principal);
  const interestPerCycle = principal.times(0.15);

  // Compute "what's due now" from installments
  const now = today();
  const pastDueCycles = loan.installments.filter(
    (i) => i.dueDate <= now && i.status !== 'SETTLED' && i.status !== 'INTEREST_PAID'
  );

  async function recordPayment(formData: FormData) {
    'use server';
    const me = await requireUser();
    if (!canRecordPayments(me.role)) throw new Error('Forbidden');

    const amount = Number(formData.get('amount'));
    if (!amount || amount <= 0) throw new Error('Invalid amount');
    const paidAt = String(formData.get('paidAt') ?? new Date().toISOString().slice(0, 10));
    const method = String(formData.get('method') ?? 'CASH') as 'CASH' | 'MPESA' | 'BANK' | 'OTHER';
    const reference = String(formData.get('reference') ?? '');
    const note = String(formData.get('note') ?? '');
    const installmentId = String(formData.get('installmentId') ?? '');

    await prisma.$transaction(async (tx) => {
      const l = await tx.loan.findUnique({
        where: { id },
        include: { installments: { orderBy: { cycleNumber: 'asc' } }, payments: true },
      });
      if (!l) throw new Error('Loan missing');

      const paidSoFar = sum(l.payments.map((p) => p.amount as unknown as string));
      const principalPaidSoFar = sum(l.payments.map((p) => p.principalPortion as unknown as string));
      const interestPaidSoFar = sum(l.payments.map((p) => p.interestPortion as unknown as string));
      const principalAmt = money(l.principal as unknown as string);

      // Total interest accrued so far = 15% × min(elapsed cycles, 3)
      const cycleInterest = principalAmt.times(0.15);
      const elapsedCycles = Math.min(
        3,
        Math.max(
          1,
          l.installments.filter((i) => i.dueDate <= new Date(paidAt + 'T00:00:00Z') ).length || 1
        )
      );
      const totalInterestAccrued = cycleInterest.times(elapsedCycles);
      const interestOwedNow = totalInterestAccrued.minus(interestPaidSoFar).clampedTo(0, totalInterestAccrued);
      const principalOwedNow = principalAmt.minus(principalPaidSoFar);

      const amt = money(amount);
      const intPart = amt.lte(interestOwedNow) ? amt : interestOwedNow;
      const remainingForPrincipal = amt.minus(intPart);
      const princPart = remainingForPrincipal.gt(principalOwedNow) ? principalOwedNow : remainingForPrincipal;
      // Anything left beyond principal+interest is treated as overpayment, but we still record as principal.
      const overpay = remainingForPrincipal.minus(princPart);
      const finalPrincipalPart = princPart.plus(overpay);

      await tx.payment.create({
        data: {
          loanId: id,
          installmentId: installmentId || null,
          amount: amt.toFixed(2),
          principalPortion: finalPrincipalPart.toFixed(2),
          interestPortion: intPart.toFixed(2),
          paidAt: new Date(paidAt + 'T00:00:00Z'),
          method,
          reference: reference || null,
          note: note || null,
          recordedById: me.id,
        },
      });

      // Recompute status
      const newPrincipalPaid = principalPaidSoFar.plus(finalPrincipalPart);
      const newTotalInterestPaid = interestPaidSoFar.plus(intPart);

      // Update installment statuses
      const ints = await tx.installment.findMany({
        where: { loanId: id },
        orderBy: { cycleNumber: 'asc' },
      });
      let interestRemaining = newTotalInterestPaid;
      for (const inst of ints) {
        const ei = money(inst.expectedInterest as unknown as string);
        const isPaidPrincipal = newPrincipalPaid.gte(principalAmt);
        if (isPaidPrincipal) {
          if (inst.status !== 'SETTLED') {
            await tx.installment.update({ where: { id: inst.id }, data: { status: 'SETTLED' } });
          }
          continue;
        }
        if (interestRemaining.gte(ei)) {
          if (inst.status !== 'INTEREST_PAID' && inst.status !== 'SETTLED') {
            await tx.installment.update({ where: { id: inst.id }, data: { status: 'INTEREST_PAID' } });
          }
          interestRemaining = interestRemaining.minus(ei);
        } else {
          // not yet covered
          if (inst.dueDate <= new Date() && inst.status === 'PENDING') {
            await tx.installment.update({ where: { id: inst.id }, data: { status: 'OVERDUE' } });
          }
        }
      }

      // Loan status
      const principalSettled = newPrincipalPaid.gte(principalAmt);
      let newStatus: 'ACTIVE' | 'SETTLED' | 'OVERDUE' | 'DEFAULTED' = 'ACTIVE';
      if (principalSettled) newStatus = 'SETTLED';
      else if (l.dueAt < new Date()) newStatus = 'DEFAULTED';
      else if (ints.some((i) => i.dueDate < new Date() && i.status === 'OVERDUE')) newStatus = 'OVERDUE';
      await tx.loan.update({ where: { id }, data: { status: newStatus } });

      await audit({
        actorId: me.id,
        action: 'record_payment',
        entity: 'Loan',
        entityId: id,
        after: { amount, paidAt, method, interestPortion: intPart.toFixed(2), principalPortion: finalPrincipalPart.toFixed(2), newStatus },
      });
    });

    revalidatePath(`/loans/${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Loan · {formatTZS(principal)} to{' '}
            <Link className="hover:underline" href={`/customers/${loan.customerId}`}>{loan.customer.fullName}</Link>
          </h1>
          <div className="text-sm text-slate-500">
            Disbursed {fmtDate(loan.disbursedAt)} · Due {fmtDate(loan.dueAt)} · Issued by {loan.issuedBy.name}
          </div>
        </div>
        <span className={
          loan.status === 'SETTLED' ? 'badge-green' :
          loan.status === 'ACTIVE' ? 'badge-blue' :
          loan.status === 'OVERDUE' ? 'badge-yellow' :
          loan.status === 'DEFAULTED' ? 'badge-red' : 'badge-slate'
        }>{loan.status}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Principal" value={formatTZS(principal)} />
        <Kpi title="Interest / cycle" value={formatTZS(interestPerCycle)} />
        <Kpi title="Paid (total)" value={formatTZS(totalPaid)} sub={`P ${formatTZS(principalPaid)} · I ${formatTZS(interestPaid)}`} />
        <Kpi title="Principal outstanding" value={formatTZS(principalOutstanding)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Repayment schedule</h2>
          <table className="table">
            <thead><tr><th>Cycle</th><th>Due</th><th>Interest</th><th>Settle option</th><th>Status</th></tr></thead>
            <tbody>
              {loan.installments.map((i) => (
                <tr key={i.id}>
                  <td>#{i.cycleNumber}</td>
                  <td>{fmtDate(i.dueDate)}</td>
                  <td>{formatTZS(i.expectedInterest as unknown as string)}</td>
                  <td>{formatTZS(money(i.expectedInterest as unknown as string).plus(money(i.expectedPrincipalAtThisCycle as unknown as string)))}</td>
                  <td><span className={
                    i.status === 'SETTLED' ? 'badge-green' :
                    i.status === 'INTEREST_PAID' ? 'badge-blue' :
                    i.status === 'OVERDUE' ? 'badge-red' : 'badge-slate'
                  }>{i.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pastDueCycles.length > 0 && (
            <div className="mt-3 text-xs text-red-700">⚠ {pastDueCycles.length} cycle(s) past due</div>
          )}
        </section>

        {canRecordPayments(user.role) && loan.status !== 'SETTLED' && (
          <section className="card p-4">
            <h2 className="font-semibold mb-3">Record payment</h2>
            <form action={recordPayment} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount (TZS)</label>
                  <input name="amount" type="number" min="1" step="1" required className="input" />
                </div>
                <div>
                  <label className="label">Paid on</label>
                  <input name="paidAt" type="date" required className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
                </div>
                <div>
                  <label className="label">Method</label>
                  <select name="method" className="select" defaultValue="CASH">
                    <option>CASH</option><option>MPESA</option><option>BANK</option><option>OTHER</option>
                  </select>
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input name="reference" className="input" placeholder="Receipt / tx id" />
                </div>
                <div className="col-span-2">
                  <label className="label">Cycle (optional)</label>
                  <select name="installmentId" className="select">
                    <option value="">Auto (apply to oldest open)</option>
                    {loan.installments.map((i) => (
                      <option key={i.id} value={i.id}>
                        Cycle #{i.cycleNumber} — due {fmtDate(i.dueDate)} ({i.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Note</label>
                  <textarea name="note" rows={2} className="textarea" />
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Quick suggest: interest only = <strong>{formatTZS(interestPerCycle)}</strong> · settle now = <strong>{formatTZS(principalOutstanding.plus(interestPerCycle))}</strong>.
              </div>
              <button className="btn-primary w-full">Record payment</button>
            </form>
          </section>
        )}
      </div>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Payments ({loan.payments.length})</h2>
        <table className="table">
          <thead><tr><th>Date</th><th>Amount</th><th>Interest</th><th>Principal</th><th>Method</th><th>Ref</th><th>By</th></tr></thead>
          <tbody>
            {loan.payments.map((p) => (
              <tr key={p.id}>
                <td>{fmtDateTime(p.paidAt)}</td>
                <td className="font-medium">{formatTZS(p.amount as unknown as string)}</td>
                <td>{formatTZS(p.interestPortion as unknown as string)}</td>
                <td>{formatTZS(p.principalPortion as unknown as string)}</td>
                <td>{p.method}</td>
                <td className="text-xs text-slate-500">{p.reference || '—'}</td>
                <td className="text-xs text-slate-500">{p.recordedBy.name}</td>
              </tr>
            ))}
            {loan.payments.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-500 py-6">No payments yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
