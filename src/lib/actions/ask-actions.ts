"use server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { AiError, aiChat, type ChatMessage } from "@/lib/ai/client";
import { LENDO_TOOLS, LendoData, runLendoTool } from "@/lib/ai/lendo-tools";

const READ_ROLES = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];
const MAX_TOOL_ROUNDS = 6;

export type AskTurn = { role: "user" | "assistant"; content: string };
export type AskResult = { ok: true; answer: string; lookups: string[] } | { ok: false; error: string };

function systemPrompt(): string {
  return `You are Lendo AI, the assistant inside Lendo, a small lending business in Tanzania. Today is ${formatDate(new Date(), "EEEE d MMMM yyyy")} (Africa/Dar_es_Salaam).

How Lendo lends: each loan charges 15% interest per 30-day round on the balance still owed; there are 3 rounds; in each round the borrower pays at least that round's interest, and the final round must be paid in full. Profit means interest earned. A Lendo Score of 100 is perfect; below 50 is not eligible for a new loan.

Rules:
- Answer staff questions using ONLY what the tools return. Never invent names, amounts or dates. If the tools don't have it, say so.
- When you only have a name, call find_customers first; if several people match, list them briefly and ask which one.
- You can only read. You cannot record, change, delete or send anything. If asked to, say where in Lendo to do it (for example: open the loan and use "Record payment").
- When counting, count people and loans separately (one person can have several loans).
- Amounts: "minimum_to_pay" / "overdue_now" is what must be paid by the due date (the round's interest; on the final round it is the whole balance). "to_clear_loan" / "owes_now" is the whole balance. Never call the whole balance "due" unless it's the final round.
- Timing: use "days_until_due" (0 = today, 1 = tomorrow, negative = overdue) exactly; never work out days yourself.
- Totals: never add up, subtract or multiply amounts yourself — use the totals the tools give. For interest / profit in a month (collected, expected, projected, "except X"), call interest_for_month (pass exclude_customers) and quote its numbers exactly. If a name to exclude wasn't found ("exclude_not_found"), say so.
- Keep lists short: at most 12 lines. If there are more, give the total and the biggest items, and offer the rest.
- Reply in the same language the user writes in (Kiswahili or English).
- Be brief: give the direct answer first, then the key details. Money as "TSh 1,250,000". Dates like "9 Nov 2026". Use short bullet points for lists. No tables.`;
}

export async function askLendo(history: AskTurn[]): Promise<AskResult> {
  const user = await getCurrentUser();
  if (!user || !READ_ROLES.includes(user.role)) {
    return { ok: false, error: "Ask Lendo isn't available for your account." };
  }
  const turns = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
  const question = turns[turns.length - 1];
  if (!question || question.role !== "user" || !question.content.trim()) {
    return { ok: false, error: "Type a question first." };
  }

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt() }, ...turns];
  const data = new LendoData();
  const lookups: string[] = [];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await aiChat({
        messages,
        tools: round < MAX_TOOL_ROUNDS ? LENDO_TOOLS : undefined,
        maxTokens: 4000,
        effort: "low",
      });
      if (!res.toolCalls.length) {
        // Never show a reply that was cut off as if it were complete.
        const cut = res.finishReason === "length";
        await audit({
          actorId: user.id,
          action: "ai.ask",
          entity: "Question",
          entityId: "ask",
          after: { question: question.content.slice(0, 500), lookups },
        });
        const answer = res.content.trim() || "Sorry, I couldn't find an answer.";
        return {
          ok: true,
          answer: cut
            ? `${answer}…\n\n(This answer was cut short because it was too long. Ask for a shorter version, or for one part at a time.)`
            : answer,
          lookups,
        };
      }
      messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        lookups.push(call.function.name);
        const result = await runLendoTool(call.function.name, call.function.arguments, data);
        messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 20_000) });
      }
    }
    return { ok: false, error: "That question needed too many lookups. Try asking something more specific." };
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[askLendo]", err);
    return { ok: false, error: "Lendo AI hit an unexpected problem. Please try again." };
  }
}
