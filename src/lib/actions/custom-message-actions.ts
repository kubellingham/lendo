"use server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { AiError, aiChat, extractJson } from "@/lib/ai/client";
import { getBranding, getPaymentDetails } from "@/lib/settings";
import { buildLoanFacts, composePrompt, type CustomLanguage, type CustomTone } from "@/lib/ai/custom-message";
import { checkMessage, type Fact, type NumberCheck } from "@/lib/message-check";

// "Write my own" WhatsApp messages: the staff member's own words, written up
// properly by Lendo AI from this loan's records, then checked number by number.

const ALLOWED = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];

export type CustomContext = { kind: "loan"; loanId: string } | { kind: "payment"; paymentId: string };

export type CustomFactsResult =
  | { ok: true; facts: Fact[]; phoneE164: string; customerName: string }
  | { ok: false; error: string };

export type ComposeResult =
  | { ok: true; message: string; staffNotes: string[]; checks: NumberCheck[] }
  | { ok: false; error: string };

async function loanIdFor(ctx: CustomContext): Promise<string | null> {
  if (ctx?.kind === "loan" && typeof ctx.loanId === "string") return ctx.loanId;
  if (ctx?.kind === "payment" && typeof ctx.paymentId === "string") {
    const p = await db.payment.findUnique({ where: { id: ctx.paymentId }, select: { loanId: true } });
    return p?.loanId ?? null;
  }
  return null;
}

async function loadFacts(ctx: CustomContext) {
  const loanId = await loanIdFor(ctx);
  if (!loanId) return null;
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      customer: { select: { fullName: true, phone: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        select: { id: true, amount: true, installmentId: true, paidAt: true, createdAt: true, method: true },
      },
    },
  });
  if (!loan) return null;
  const [pay, brand] = await Promise.all([getPaymentDetails(), getBranding()]);
  return {
    facts: buildLoanFacts(loan, pay, { name: brand.name || "Lendo", phone: brand.phone }),
    phoneE164: loan.customer.phone,
    customerName: loan.customer.fullName,
  };
}

async function staff() {
  const user = await getCurrentUser();
  return user && ALLOWED.includes(user.role) ? user : null;
}

/** The loan's facts (shown to staff before writing, and used to check the result). */
export async function customMessageFacts(ctx: CustomContext): Promise<CustomFactsResult> {
  if (!(await staff())) return { ok: false, error: "Not available for your account." };
  const loaded = await loadFacts(ctx);
  if (!loaded) return { ok: false, error: "Loan not found." };
  return { ok: true, ...loaded };
}

/** Write the staff member's message properly, from the records, and check every number. */
export async function composeCustomMessage(input: {
  context: CustomContext;
  note: string;
  tone: CustomTone;
  language: CustomLanguage;
}): Promise<ComposeResult> {
  const user = await staff();
  if (!user) return { ok: false, error: "Not available for your account." };
  const note = String(input.note ?? "").trim();
  if (note.length < 3) return { ok: false, error: "Write what you want to tell them first." };
  if (note.length > 2000) return { ok: false, error: "That note is too long — keep it under 2,000 characters." };
  const tone: CustomTone = input.tone === "formal" || input.tone === "firm" ? input.tone : "warm";
  const language: CustomLanguage = input.language === "en" ? "en" : "sw";

  const loaded = await loadFacts(input.context);
  if (!loaded) return { ok: false, error: "Loan not found." };

  let reply: string;
  try {
    const res = await aiChat({
      maxTokens: 2500,
      effort: "low",
      messages: [
        { role: "system", content: composePrompt({ language, tone, facts: loaded.facts }) },
        { role: "user", content: `What the staff member wants to tell the borrower:\n"""\n${note}\n"""` },
      ],
    });
    reply = res.content;
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[composeCustomMessage]", err);
    return { ok: false, error: "Lendo AI hit an unexpected problem. Please try again." };
  }

  const parsed = extractJson(reply) as { message?: unknown; staff_notes?: unknown } | null;
  const message = (typeof parsed?.message === "string" ? parsed.message : reply).trim();
  if (!message) return { ok: false, error: "Lendo AI didn't write anything. Try again or add more detail." };
  const staffNotes = Array.isArray(parsed?.staff_notes)
    ? parsed.staff_notes.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 5)
    : [];

  await audit({
    actorId: user.id,
    action: "ai.custom_message",
    entity: input.context.kind === "loan" ? "Loan" : "Payment",
    entityId: input.context.kind === "loan" ? input.context.loanId : input.context.paymentId,
    after: { note: note.slice(0, 500), tone, language },
  });

  return { ok: true, message, staffNotes, checks: checkMessage(message, loaded.facts, note) };
}
