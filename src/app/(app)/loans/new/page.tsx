import { db } from "@/lib/db";
import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { LoanForm, type CustomerOption } from "@/components/loans/loan-form";

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: string;
    principal?: string;
    disbursedAt?: string;
    reference?: string;
    ai?: string;
  }>;
}) {
  await requirePageRole(...WRITE_ROLES);
  const { customerId, principal, disbursedAt, reference, ai } = await searchParams;
  // Values handed over by Lendo AI from a receipt (staff still review them).
  const prefill = {
    principal: principal && /^\d+(\.\d{1,2})?$/.test(principal) ? principal : undefined,
    disbursedAt: disbursedAt && /^\d{4}-\d{2}-\d{2}$/.test(disbursedAt) ? disbursedAt : undefined,
    reference: reference?.slice(0, 120) || undefined,
    fromReceipt: ai === "1",
  };

  const customers = await db.customer.findMany({
    orderBy: { fullName: "asc" },
    take: 1000,
    select: {
      id: true,
      fullName: true,
      businessName: true,
      phone: true,
      isFlagged: true,
      flagReason: true,
    },
  });

  const options: CustomerOption[] = customers.map((c) => ({
    id: c.id,
    label: `${c.fullName}${c.businessName ? ` (${c.businessName})` : ""} · ${c.phone}`,
    isBlacklisted: c.isFlagged && (c.flagReason ?? "").startsWith("BLACKLIST"),
  }));

  return (
    <>
      <PageHeader
        title="Issue loan"
        description="Create a new loan and generate its repayment schedule."
      />
      <LoanForm customers={options} preselectedCustomerId={customerId} prefill={prefill} />
    </>
  );
}
