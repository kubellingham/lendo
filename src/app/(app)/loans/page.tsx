import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { formatTZS } from "@/lib/money";
import { computeLoanState, deriveStatuses } from "@/lib/loan-calc";
import { nowInTz } from "@/lib/dates";
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

  // Load everything and evaluate the *effective* status (so a loan that has
  // rolled its final cycle reads as Defaulted immediately), then filter in
  // memory. Heal any stored status that has drifted so counts elsewhere agree.
  const loans = await db.loan.findMany({
    include: {
      customer: { select: { fullName: true } },
      issuedBy: { select: { name: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: { select: { amount: true, installmentId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const now = nowInTz();
  const drifted: { id: string; status: LoanStatus }[] = [];

  const evaluated = loans.map((loan) => {
    const state = computeLoanState({
      principal: loan.principal,
      status: loan.status,
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments,
    });
    const { loanStatus } = deriveStatuses(
      {
        principal: loan.principal,
        status: loan.status,
        interestRatePct: loan.interestRatePct,
        cyclesAllowed: loan.cyclesAllowed,
        installments: loan.installments,
        payments: [],
      },
      state,
      state.currentCycle ?? loan.cyclesAllowed,
      loan.dueAt,
      now,
    );
    if (loanStatus !== loan.status && loan.status !== "WRITTEN_OFF") {
      drifted.push({ id: loan.id, status: loanStatus });
    }
    return { loan, state, effectiveStatus: loanStatus };
  });

  if (drifted.length > 0) {
    await Promise.all(
      drifted.map((d) =>
        db.loan.update({ where: { id: d.id }, data: { status: d.status } }),
      ),
    );
  }

  const rows: LoanRow[] = evaluated
    .filter((e) => !statusFilter || e.effectiveStatus === statusFilter)
    .map(({ loan, state, effectiveStatus }) => ({
      id: loan.id,
      customerName: loan.customer.fullName,
      principal: formatTZS(loan.principal.toString()),
      principalNum: Number(loan.principal),
      outstanding: formatTZS(state.principalOutstanding),
      outstandingNum: Number(state.principalOutstanding.toString()),
      status: effectiveStatus,
      disbursedAt: formatDate(loan.disbursedAt),
      disbursedAtMs: loan.disbursedAt.getTime(),
      dueAt: formatDate(loan.dueAt),
      dueAtMs: loan.dueAt.getTime(),
      officer: loan.issuedBy.name,
    }));

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
