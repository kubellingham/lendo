import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/components/customers/customer-form";

export default async function NewCustomerPage() {
  await requirePageRole(...WRITE_ROLES);
  return (
    <>
      <PageHeader
        title="New customer"
        description="Create a borrower record."
      />
      <CustomerForm />
    </>
  );
}
