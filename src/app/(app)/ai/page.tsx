import { redirect } from "next/navigation";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { aiConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/layout/page-header";
import { AiSetupCard } from "@/components/ai/ai-setup-card";
import { ReceiptScanner } from "@/components/ai/receipt-scanner";

export default async function LendoAiPage() {
  const user = await requireUser();
  // Scanning leads to recording, so it's for staff who can record.
  if (!WRITE_ROLES.includes(user.role)) redirect("/ai/ask");

  return (
    <>
      <PageHeader
        title="Lendo AI · Scan receipts"
        description="Upload a bank or M-Pesa receipt. Lendo AI reads it, finds the customer and fills in the form — you check and approve."
      />
      {aiConfigured() ? <ReceiptScanner /> : <AiSetupCard />}
    </>
  );
}
