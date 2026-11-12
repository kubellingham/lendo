import { requireUser } from "@/lib/rbac";
import { aiConfigured } from "@/lib/ai/client";
import { getAskChat, listAskChats } from "@/lib/actions/ask-actions";
import { PageHeader } from "@/components/layout/page-header";
import { AiSetupCard } from "@/components/ai/ai-setup-card";
import { AskLendo } from "@/components/ai/ask-lendo";

// A question can take a few lookups.
export const maxDuration = 60;

export default async function AskLendoPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  await requireUser();
  const { chat } = await searchParams;
  const ready = aiConfigured();
  const [chats, current] = ready
    ? await Promise.all([listAskChats(), chat ? getAskChat(chat) : Promise.resolve(null)])
    : [[], null];
  return (
    <>
      <PageHeader
        title="Lendo AI · Ask Lendo"
        description="Ask about customers, loans and money in plain words — English or Kiswahili. Lendo AI only reads; it can't change anything. Every chat is saved with its date and time."
      />
      {ready ? <AskLendo key={current?.id ?? "new"} initialChats={chats} initialChat={current} /> : <AiSetupCard />}
    </>
  );
}
