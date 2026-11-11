"use server";

import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { AiError, aiChat, aiConfigured } from "@/lib/ai/client";
import { runLendoTool } from "@/lib/ai/lendo-tools";

export type SummaryResult = { ok: true; text: string | null } | { ok: false; error: string };

const PROMPT = `You summarise a borrower's history for Lendo, a small lending business in Tanzania, for the staff member about to issue them a new loan. You get the customer's records as JSON (amounts in TSh; each loan has rounds of 30 days at 15% interest; "days_after_round_due" > 0 means the payment was late by that many days).

Write 2 or 3 short, plain English sentences covering: how many loans and how much in total; how they paid (on time, or late — say the worst lateness); whether past loans were finished in full; and what they owe right now.
Facts only. Use the numbers exactly as given; money as "TSh 1,000,000" and dates like "2 Jun 2026". Do not recommend whether to lend. No bullet points, no heading.`;

/** Plain-words history for the Issue loan form (null when there is no history). */
export async function summarizeCustomer(customerId: string): Promise<SummaryResult> {
  try {
    await requireRole(...WRITE_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  if (!aiConfigured()) return { ok: true, text: null };

  const details = await runLendoTool("customer_details", JSON.stringify({ customer_id: customerId }));
  let parsed: { loans?: unknown[] } = {};
  try {
    parsed = JSON.parse(details);
  } catch {}
  if (!parsed.loans?.length) return { ok: true, text: null };

  try {
    const res = await aiChat({
      effort: "none",
      maxTokens: 400,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: details.slice(0, 20_000) },
      ],
    });
    return { ok: true, text: res.content.trim() || null };
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[summarizeCustomer]", err);
    return { ok: false, error: "Couldn't summarise this customer's history." };
  }
}
