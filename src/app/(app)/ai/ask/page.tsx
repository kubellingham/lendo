import { requireUser } from "@/lib/rbac";
import { aiConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/layout/page-header";
import { AiSetupCard } from "@/components/ai/ai-setup-card";
import { AskLendo } from "@/components/ai/ask-lendo";

// A question can take a few lookups.
export const maxDuration = 60;

export default async function AskLendoPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Lendo AI · Ask Lendo"
        description="Ask about customers, loans and money in plain words — English or Kiswahili. Lendo AI only reads; it can't change anything."
      />
      {aiConfigured() ? <AskLendo /> : <AiSetupCard />}
    </>
  );
}
