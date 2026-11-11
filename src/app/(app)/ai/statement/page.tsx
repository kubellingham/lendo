import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { aiConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/layout/page-header";
import { AiSetupCard } from "@/components/ai/ai-setup-card";
import { StatementChecker } from "@/components/ai/statement-checker";

export default async function StatementCheckPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="Lendo AI · Check statement"
        description="Upload a bank statement PDF. Lendo AI lists every transaction and shows which ones are missing from Lendo."
      />
      {aiConfigured() ? (
        <StatementChecker canWrite={WRITE_ROLES.includes(user.role)} />
      ) : (
        <AiSetupCard />
      )}
    </>
  );
}
