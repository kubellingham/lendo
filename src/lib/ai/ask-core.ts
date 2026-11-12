import { formatDateTime } from "@/lib/dates";
import { aiChat, type ChatMessage } from "@/lib/ai/client";
import { LENDO_TOOLS, LendoData, runLendoTool } from "@/lib/ai/lendo-tools";

// The Ask Lendo loop (model ⇄ read-only lookups), kept free of the database
// so it can be tested. Saving chats lives in the server actions.

export const MAX_TOOL_ROUNDS = 6;

/** One lookup Lendo AI made, with the result exactly as it was at that moment. */
export type SnapshotLookup = { tool: string; args: unknown; result: unknown };
export type AskSnapshot = { at: string; lookups: SnapshotLookup[] };

/** An earlier message in the chat, with when it was said. */
export type PastTurn = { role: "user" | "assistant"; content: string; at: Date };

const SNAPSHOT_RESULT_CHARS = 20_000;
const SNAPSHOT_TOTAL_CHARS = 80_000;

export function systemPrompt(now: Date = new Date()): string {
  return `You are Lendo AI, the assistant inside Lendo, a small lending business in Tanzania. Right now it is ${formatDateTime(now, "EEEE d MMMM yyyy, HH:mm")} (Africa/Dar_es_Salaam).

How Lendo lends: each loan charges 15% interest per 30-day round on the balance still owed; there are 3 rounds; in each round the borrower pays at least that round's interest, and the final round must be paid in full. Profit means interest earned. A Lendo Score of 100 is perfect; below 50 is not eligible for a new loan.

Rules:
- Answer staff questions using ONLY what the tools return. Never invent names, amounts or dates. If the tools don't have it, say so.
- When you only have a name, call find_customers first; if several people match, list them briefly and ask which one.
- You can only read. You cannot record, change, delete or send anything. If asked to, say where in Lendo to do it (for example: open the loan and use "Record payment").
- When counting, count people and loans separately (one person can have several loans).
- Amounts: "minimum_to_pay" / "overdue_now" is what must be paid by the due date (the round's interest; on the final round it is the whole balance). "to_clear_loan" / "owes_now" is the whole balance. Never call the whole balance "due" unless it's the final round.
- Timing: use "days_until_due" (0 = today, 1 = tomorrow, negative = overdue) exactly; never work out days yourself.
- Totals: never add up, subtract or multiply amounts yourself — use the totals the tools give. For interest / profit in a month (collected, expected, projected, "except X"), call interest_for_month (pass exclude_customers) and quote its numbers exactly. When you exclude someone, say who was left out (exclusion.left_out) and trust it; mention look-alike names that were not left out only as a note, and say so if a name was not found. To compare with last month use vs_last_month — it already has the difference, on the same basis (same_customers = with the same people left out; all_customers = everyone). Never subtract yourself, and never compare a figure with someone left out against one that includes them.
- Keep lists short: at most 12 lines. If there are more, give the total and the biggest items, and offer the rest.
- Reply in the same language the user writes in (Kiswahili or English).
- Be brief: give the direct answer first, then the key details. Money as "TSh 1,250,000". Dates like "9 Nov 2026". Use short bullet points for lists. No tables.

Chat history and time:
- This chat may go back days or weeks. Each earlier message starts with the time it was said, like "[12 Nov 2026, 17:56]".
- Figures in earlier answers were true at that time and may have changed since (payments, new loans). For anything about now, look it up again — never reuse an old figure as if it were current.
- If asked how something changed since an earlier answer, give the earlier figure with its time, then the fresh figure now.
- Do not start your own reply with a time in brackets.`;
}

const stamp = (d: Date) => `[${formatDateTime(d, "d MMM yyyy, HH:mm")}]`;

/** The model's view of the chat: earlier turns carry their time; the new question is "now". */
export function buildMessages(past: PastTurn[], question: string, now: Date = new Date()): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(now) },
    ...past.slice(-12).map((t) => ({
      role: t.role,
      content: `${stamp(t.at)} ${t.content.slice(0, 4000)}`,
    })),
    { role: "user", content: question.slice(0, 4000) },
  ];
}

function parseResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type AskOutcome =
  | { ok: true; answer: string; lookups: string[]; snapshot: AskSnapshot }
  | { ok: false; error: string; lookups: string[] };

/** Run the question: lookups as the model asks for them, then its answer. */
export async function answerQuestion(messages: ChatMessage[], now: Date = new Date()): Promise<AskOutcome> {
  const data = new LendoData();
  const lookups: string[] = [];
  const snapshot: AskSnapshot = { at: now.toISOString(), lookups: [] };
  let snapshotChars = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await aiChat({
      messages,
      tools: round < MAX_TOOL_ROUNDS ? LENDO_TOOLS : undefined,
      maxTokens: 4000,
      effort: "low",
    });
    if (!res.toolCalls.length) {
      const answer = res.content.trim().replace(/^\[\d{1,2} \w{3} \d{4}, \d{2}:\d{2}\]\s*/, "") ||
        "Sorry, I couldn't find an answer.";
      // Never show a reply that was cut off as if it were complete.
      const cut = res.finishReason === "length";
      return {
        ok: true,
        answer: cut
          ? `${answer}…\n\n(This answer was cut short because it was too long. Ask for a shorter version, or for one part at a time.)`
          : answer,
        lookups,
        snapshot,
      };
    }
    messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      lookups.push(call.function.name);
      const result = await runLendoTool(call.function.name, call.function.arguments, data);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 20_000) });
      // Keep what was looked up, as it was right now.
      const kept = result.slice(0, SNAPSHOT_RESULT_CHARS);
      if (snapshotChars + kept.length <= SNAPSHOT_TOTAL_CHARS) {
        snapshotChars += kept.length;
        snapshot.lookups.push({
          tool: call.function.name,
          args: parseResult(call.function.arguments || "{}"),
          result: kept.length === result.length ? parseResult(kept) : kept + "…",
        });
      }
    }
  }
  return { ok: false, error: "That question needed too many lookups. Try asking something more specific.", lookups };
}
