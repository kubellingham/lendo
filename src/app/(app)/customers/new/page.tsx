import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/components/customers/customer-form";

export default async function NewCustomerPage() {
  await requirePageRole(...WRITE_ROLES);
  const referrals = await db.referral.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, relationship: true },
  });
  return (
    <>
      <PageHeader
        title="New customer"
        description="Create a borrower record."
      />
      <CustomerForm referrals={referrals} />
    </>
  );
}
