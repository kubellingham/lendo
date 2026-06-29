import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { dispatchQueued } from '@/lib/whatsapp';

export const runtime = 'nodejs';

function unauthorized() {
  return new NextResponse('Unauthorized', { status: 401 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (secret && auth !== `Bearer ${secret}` && tokenFromQuery !== secret) {
    return unauthorized();
  }

  const result = await runDaily();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}

async function runDaily() {
  const now = new Date();
  const day = (n: number) => new Date(now.getTime() + n * 24 * 3600 * 1000);

  // 1. Mark overdue installments / loans
  await prisma.installment.updateMany({
    where: { status: 'PENDING', dueDate: { lt: now } },
    data: { status: 'OVERDUE' },
  });

  const overdueLoans = await prisma.loan.findMany({
    where: { status: 'ACTIVE', dueAt: { lt: now } },
    select: { id: true },
  });
  for (const l of overdueLoans) {
    const ints = await prisma.installment.findMany({ where: { loanId: l.id } });
    const anySettled = ints.some((i) => i.status === 'SETTLED');
    await prisma.loan.update({
      where: { id: l.id },
      data: { status: anySettled ? 'SETTLED' : 'DEFAULTED' },
    });
  }

  await prisma.loan.updateMany({
    where: {
      status: 'ACTIVE',
      installments: { some: { status: 'OVERDUE' } },
    },
    data: { status: 'OVERDUE' },
  });

  // 2. Queue WhatsApp reminders
  // 2a. Due in 3 days
  const dueSoon = await prisma.installment.findMany({
    where: {
      status: { in: ['PENDING', 'INTEREST_PAID'] },
      dueDate: { gte: day(2), lte: day(3) },
    },
    include: { loan: { include: { customer: true } } },
  });
  // 2b. Due today
  const dueToday = await prisma.installment.findMany({
    where: {
      status: { in: ['PENDING', 'INTEREST_PAID'] },
      dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lte: day(1) },
    },
    include: { loan: { include: { customer: true } } },
  });
  // 2c. Overdue
  const overdueInst = await prisma.installment.findMany({
    where: { status: 'OVERDUE' },
    include: { loan: { include: { customer: true } } },
  });

  let queued = 0;
  for (const i of dueSoon) {
    queued += await enqueueIfNew(i.loanId, i.id, 'due_in_3_days', i.loan.customer, i);
  }
  for (const i of dueToday) {
    queued += await enqueueIfNew(i.loanId, i.id, 'due_today', i.loan.customer, i);
  }
  for (const i of overdueInst) {
    const overdueDays = Math.floor((now.getTime() - i.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const template = overdueDays >= 7 ? 'overdue_7d' : 'overdue_1d';
    queued += await enqueueIfNew(i.loanId, i.id, template, i.loan.customer, i);
  }

  // 3. Dispatch QUEUED
  const dispatch = await dispatchQueued(100);

  return { overdueMarked: overdueInst.length, queued, dispatch };
}

async function enqueueIfNew(
  loanId: string,
  installmentId: string,
  template: string,
  customer: { id: string; fullName: string; phone: string },
  installment: { dueDate: Date; expectedInterest: { toString(): string }; expectedPrincipalAtThisCycle: { toString(): string } },
) {
  const dedupeFrom = new Date(Date.now() - 6 * 3600 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      customerId: customer.id,
      loanId,
      template,
      createdAt: { gte: dedupeFrom },
    },
  });
  if (existing) return 0;
  await prisma.notification.create({
    data: {
      customerId: customer.id,
      loanId,
      channel: 'WHATSAPP',
      template,
      payloadJson: {
        name: customer.fullName,
        amount: installment.expectedInterest.toString(),
        dueDate: installment.dueDate.toISOString().slice(0, 10),
        installmentId,
      },
      scheduledFor: new Date(),
      status: 'QUEUED',
    },
  });
  return 1;
}
