import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import type { CustomerInput } from "@/lib/validation";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageRole(...WRITE_ROLES);
  const { id } = await params;
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  const defaults: Partial<CustomerInput> = {
    type: customer.type,
    fullName: customer.fullName,
    businessName: customer.businessName ?? "",
    nationalIdNumber: customer.nationalIdNumber ?? "",
    phone: customer.phone,
    altPhone: customer.altPhone ?? "",
    email: customer.email ?? "",
    addressLine: customer.addressLine,
    city: customer.city,
    region: customer.region,
    occupation: customer.occupation ?? "",
    employer: customer.employer ?? "",
    businessTin: customer.businessTin ?? "",
    notes: customer.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Edit ${customer.fullName}`}
        description="Update borrower details."
      />
      <CustomerForm customerId={customer.id} defaultValues={defaults} />
    </>
  );
}
