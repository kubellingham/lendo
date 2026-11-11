import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import { AiPrefillBanner } from "@/components/ai/ai-prefill-banner";

/** Accept a Tanzanian mobile number from a receipt; anything else (e.g. a bank account) is dropped. */
function asTzMobile(raw?: string): string | undefined {
  const d = (raw ?? "").replace(/\D/g, "");
  if (/^0[67]\d{8}$/.test(d)) return `+255${d.slice(1)}`;
  if (/^255[67]\d{8}$/.test(d)) return `+${d}`;
  return undefined;
}

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ fullName?: string; phone?: string; ai?: string }>;
}) {
  await requirePageRole(...WRITE_ROLES);
  const sp = await searchParams;
  const fromReceipt = sp.ai === "1";
  const defaultValues = {
    ...(sp.fullName ? { fullName: sp.fullName.slice(0, 120) } : {}),
    ...(asTzMobile(sp.phone) ? { phone: asTzMobile(sp.phone) } : {}),
  };
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
      {fromReceipt ? (
        <div className="mb-4">
          <AiPrefillBanner />
        </div>
      ) : null}
      <CustomerForm referrals={referrals} defaultValues={defaultValues} />
    </>
  );
}
