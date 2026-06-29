import { db } from "@/lib/db";
import { parseIsoDate } from "@/lib/dates";
import { PaymentMethod } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export interface PaymentFilters {
  from?: string; // yyyy-MM-dd inclusive
  to?: string; // yyyy-MM-dd inclusive
  method?: string;
}

export function buildPaymentWhere(filters: PaymentFilters): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};
  if (filters.method && filters.method in PaymentMethod) {
    where.method = filters.method as PaymentMethod;
  }
  if (filters.from || filters.to) {
    where.paidAt = {};
    if (filters.from) where.paidAt.gte = parseIsoDate(filters.from);
    if (filters.to) {
      // include the whole "to" day
      const end = parseIsoDate(filters.to);
      end.setDate(end.getDate() + 1);
      where.paidAt.lt = end;
    }
  }
  return where;
}

export async function getPaymentsLedger(filters: PaymentFilters, take = 1000) {
  return db.payment.findMany({
    where: buildPaymentWhere(filters),
    orderBy: { paidAt: "desc" },
    take,
    include: {
      loan: {
        select: {
          id: true,
          customer: { select: { fullName: true, phone: true } },
        },
      },
      recordedBy: { select: { name: true } },
    },
  });
}
