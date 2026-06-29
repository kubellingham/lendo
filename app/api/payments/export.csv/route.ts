import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || undefined;
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from') + 'T00:00:00Z') : undefined;
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to') + 'T23:59:59Z') : undefined;
  const method = url.searchParams.get('method') || undefined;

  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: from, lte: to },
      method: method ? (method as 'CASH' | 'MPESA' | 'BANK' | 'OTHER') : undefined,
      ...(q
        ? { loan: { customer: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } } }
        : {}),
    },
    orderBy: { paidAt: 'desc' },
    include: { loan: { include: { customer: true } }, recordedBy: { select: { name: true } } },
  });

  const rows = [
    ['paid_at', 'customer', 'phone', 'loan_id', 'amount', 'interest', 'principal', 'method', 'reference', 'note', 'recorded_by'].join(','),
    ...payments.map((p) =>
      [
        p.paidAt.toISOString(),
        escape(p.loan.customer.fullName),
        p.loan.customer.phone,
        p.loanId,
        p.amount.toString(),
        p.interestPortion.toString(),
        p.principalPortion.toString(),
        p.method,
        escape(p.reference || ''),
        escape(p.note || ''),
        escape(p.recordedBy.name),
      ].join(','),
    ),
  ];

  return new NextResponse(rows.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="lendo-payments.csv"',
    },
  });
}

function escape(s: string) {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
