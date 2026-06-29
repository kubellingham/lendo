import { db } from "@/lib/db";
import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { LoanForm, type CustomerOption } from "@/components/loans/loan-form";

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  await requirePageRole(...WRITE_ROLES);
  const { customerId } = await searchParams;

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
      <LoanForm customers={options} preselectedCustomerId={customerId} />
    </>
  );
}
