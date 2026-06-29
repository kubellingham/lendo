import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { formatTZS } from "@/lib/money";
import { computeLoanState } from "@/lib/loan-calc";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { LoansTable, type LoanRow } from "@/components/loans/loans-table";
import { LoanStatus } from "@/generated/prisma/enums";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "SETTLED", label: "Settled" },
  { value: "DEFAULTED", label: "Defaulted" },
  { value: "WRITTEN_OFF", label: "Written off" },
];

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { status } = await searchParams;
  const canWrite = WRITE_ROLES.includes(user.role);
  const statusFilter =
    status && status in LoanStatus ? (status as LoanStatus) : undefined;

  const loans = await db.loan.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    include: {
      customer: { select: { fullName: true } },
      issuedBy: { select: { name: true } },
      installments: true,
      payments: { select: { amount: true, installmentId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: LoanRow[] = loans.map((loan) => {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      installments: loan.installments,
      payments: loan.payments,
    });
    return {
      id: loan.id,
      customerName: loan.customer.fullName,
      principal: formatTZS(loan.principal.toString()),
      outstanding: formatTZS(state.principalOutstanding),
      status: loan.status,
      disbursedAt: formatDate(loan.disbursedAt),
      dueAt: formatDate(loan.dueAt),
      officer: loan.issuedBy.name,
    };
  });

  return (
    <>
      <PageHeader
        title="Loans"
        description="All issued loans across the portfolio."
        action={
          canWrite ? (
            <Button asChild>
              <Link href="/loans/new">
                <Plus className="size-4" /> Issue loan
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={(status ?? "") === f.value ? "default" : "outline"}
          >
            <Link href={f.value ? `/loans?status=${f.value}` : "/loans"}>
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      <LoansTable rows={rows} />
    </>
  );
}
