/* End-to-end smoke test against a running server + live DB. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateSchedule } from '../lib/schedule';
import Decimal from 'decimal.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find admin
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@lendo.local' } });

  // Clean prior smoke data
  await prisma.customer.deleteMany({ where: { phone: '+255700000001' } });

  // Create customer
  const customer = await prisma.customer.create({
    data: {
      type: 'INDIVIDUAL',
      fullName: 'Smoke Test User',
      phone: '+255700000001',
      addressLine: 'Test St 1',
      city: 'Dar es Salaam',
      region: 'Dar es Salaam',
      createdById: admin.id,
    },
  });

  // Issue 100,000 TZS loan dated today
  const disbursed = new Date(Date.UTC(2026, 5, 29));
  const schedule = generateSchedule({ principal: 100000, disbursedAt: disbursed });
  const dueAt = schedule[2].dueDate;

  const loan = await prisma.$transaction(async (tx) => {
    const l = await tx.loan.create({
      data: {
        customerId: customer.id,
        principal: '100000',
        interestRatePct: '15.00',
        cyclesAllowed: 3,
        cycleDays: 30,
        disbursedAt: disbursed,
        dueAt,
        issuedById: admin.id,
      },
    });
    await tx.installment.createMany({
      data: schedule.map((s) => ({
        loanId: l.id,
        cycleNumber: s.cycleNumber,
        dueDate: s.dueDate,
        expectedInterest: s.expectedInterest.toFixed(2),
        expectedPrincipalAtThisCycle: s.expectedPrincipalAtThisCycle.toFixed(2),
      })),
    });
    return l;
  });

  // Verify schedule
  const installments = await prisma.installment.findMany({
    where: { loanId: loan.id },
    orderBy: { cycleNumber: 'asc' },
  });
  console.log('Installments:');
  for (const i of installments) {
    console.log(`  #${i.cycleNumber} due ${i.dueDate.toISOString().slice(0, 10)} interest=${i.expectedInterest}`);
  }
  if (installments.length !== 3) throw new Error('expected 3 installments');
  installments.forEach((i) => {
    if (new Decimal(i.expectedInterest as unknown as string).toString() !== '15000') {
      throw new Error(`installment ${i.cycleNumber} interest mismatch: ${i.expectedInterest}`);
    }
  });

  // Record interest-only payment for cycle 1
  await prisma.payment.create({
    data: {
      loanId: loan.id,
      installmentId: installments[0].id,
      amount: '15000',
      principalPortion: '0',
      interestPortion: '15000',
      paidAt: schedule[0].dueDate,
      method: 'CASH',
      recordedById: admin.id,
    },
  });
  await prisma.installment.update({ where: { id: installments[0].id }, data: { status: 'INTEREST_PAID' } });

  // Record full settlement on cycle 2: principal 100000 + interest 15000
  await prisma.payment.create({
    data: {
      loanId: loan.id,
      installmentId: installments[1].id,
      amount: '115000',
      principalPortion: '100000',
      interestPortion: '15000',
      paidAt: schedule[1].dueDate,
      method: 'MPESA',
      reference: 'TEST123',
      recordedById: admin.id,
    },
  });
  await prisma.installment.update({ where: { id: installments[1].id }, data: { status: 'SETTLED' } });
  await prisma.installment.update({ where: { id: installments[2].id }, data: { status: 'SETTLED' } });
  await prisma.loan.update({ where: { id: loan.id }, data: { status: 'SETTLED' } });

  // Verify totals
  const payments = await prisma.payment.findMany({ where: { loanId: loan.id } });
  const totalAmt = payments.reduce((acc, p) => acc.plus(p.amount as unknown as string), new Decimal(0));
  const totalInt = payments.reduce((acc, p) => acc.plus(p.interestPortion as unknown as string), new Decimal(0));
  console.log(`Total paid=${totalAmt} (interest ${totalInt})`);
  if (totalAmt.toString() !== '130000') throw new Error(`expected total 130000, got ${totalAmt}`);
  if (totalInt.toString() !== '30000') throw new Error(`expected interest 30000, got ${totalInt}`);

  // Blacklist test: create flagged customer and ensure flags model works
  const flagged = await prisma.customer.create({
    data: {
      type: 'INDIVIDUAL',
      fullName: 'Risky Borrower',
      phone: '+255700000002',
      addressLine: 'Test St 2',
      city: 'Dar es Salaam',
      region: 'Dar es Salaam',
      createdById: admin.id,
      isFlagged: true,
      flagReason: 'Default history',
    },
  });
  await prisma.customerFlag.create({
    data: {
      customerId: flagged.id,
      reason: 'Default history',
      severity: 'BLACKLIST',
      createdById: admin.id,
    },
  });
  const fl = await prisma.customer.findUnique({
    where: { id: flagged.id },
    include: { flags: true },
  });
  if (!fl?.flags.some((f) => f.severity === 'BLACKLIST')) throw new Error('blacklist flag missing');

  console.log('\nSMOKE TEST OK');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
