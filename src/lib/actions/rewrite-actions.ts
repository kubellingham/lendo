"use server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/rbac";
import { AiError, aiChat } from "@/lib/ai/client";
import {
  addedNumbers,
  autoTone,
  kindOf,
  missingDetails,
  rewritePrompt,
  timingProblems,
  type Language,
  type Tone,
} from "@/lib/ai/rewrite";
import { formatDate } from "@/lib/dates";
import { loanSituation, situationSummary } from "@/lib/loan-situation";

const ALLOWED = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];
const DAY = 24 * 60 * 60 * 1000;

export type RewriteContext =
  | { kind: "loan"; loanId: string }
  | { kind: "payment"; paymentId: string }
  | { kind: "customer"; customerId: string };

export type RewriteResult =
  | {
      ok: true;
      message: string;
      /** Numbers / loan refs from the original that are missing. */
      missing: string[];
      /** Numbers that appeared in the rewrite but not the original. */
      added: string[];
      /** Timing words (today / tomorrow / overdue) whose meaning changed. */
      timing: string[];
      toneUsed: Exclude<Tone, "auto">;
      /** Why "auto" picked this tone (null when the user chose). */
      toneReason: string | null;
    }
  | { ok: false; error: string };

async function customerIdFor(ctx: RewriteContext): Promise<string | null> {
  if (ctx.kind === "customer") return ctx.customerId;
  if (ctx.kind === "loan") {
    const l = await db.loan.findUnique({ where: { id: ctx.loanId }, select: { customerId: true } });
    return l?.customerId ?? null;
  }
  const p = await db.payment.findUnique({
    where: { id: ctx.paymentId },
    select: { loan: { select: { customerId: true } } },
  });
  return p?.loan.customerId ?? null;
}

export async function rewriteMessage(input: {
  message: string;
  language: Language;
  tone: Tone;
  context: RewriteContext;
  /** Address the referral instead of the borrower (referral templates). */
  recipientName?: string;
  /** Template the message came from (sets the auto tone). */
  templateKey?: string;
}): Promise<RewriteResult> {
  const user = await getCurrentUser();
  if (!user || !ALLOWED.includes(user.role)) {
    return { ok: false, error: "Not available for your account." };
  }
  const message = String(input.message ?? "").trim();
  if (!message) return { ok: false, error: "There's no message to rewrite yet." };
  if (message.length > 4000) return { ok: false, error: "That message is too long to rewrite." };
  const language: Language = input.language === "en" ? "en" : "sw";

  const customerId = await customerIdFor(input.context);
  const customer = customerId
    ? await db.customer.findUnique({
        where: { id: customerId },
        select: {
          fullName: true,
          riskScore: true,
          riskWorstDaysLate: true,
          loans: {
            select: {
              payments: { select: { paidAt: true, installment: { select: { dueDate: true } } } },
            },
          },
        },
      })
    : null;
  const latePayments = (customer?.loans ?? [])
    .flatMap((l) => l.payments)
    .filter((p) => p.installment && p.paidAt.getTime() - p.installment.dueDate.getTime() > DAY).length;
  // The real situation of THIS loan (for loan messages): days late now,
  // and a plain sentence the AI gets as background facts.
  let situation: string | null = null;
  let daysLateNow = customer?.riskWorstDaysLate ?? 0;
  if (input.context.kind === "loan") {
    const loan = await db.loan.findUnique({
      where: { id: input.context.loanId },
      include: {
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: { select: { amount: true, installmentId: true } },
      },
    });
    if (loan) {
      const sit = loanSituation(loan);
      situation = situationSummary(sit);
      daysLateNow = sit.daysUntilDue != null && sit.daysUntilDue < 0 ? -sit.daysUntilDue : 0;
    }
  }

  const record = {
    firstName: (input.recipientName || customer?.fullName || "").split(/\s+/)[0] || "there",
    score: customer?.riskScore ?? 100,
    latePayments,
    daysLateNow,
  };
  const auto = input.tone === "auto" || !input.tone;
  const picked = autoTone(record, kindOf(input.templateKey));
  const tone = auto ? picked.tone : (input.tone as Exclude<Tone, "auto">);

  try {
    const res = await aiChat({
      effort: "none",
      maxTokens: 1500,
      messages: [
        {
          role: "system",
          content: rewritePrompt(language, tone, record, {
            today: formatDate(new Date(), "EEEE d MMMM yyyy"),
            situation,
          }),
        },
        { role: "user", content: message },
      ],
    });
    const out = res.content.trim().replace(/^```\w*\n?|```$/g, "").trim();
    if (!out) return { ok: false, error: "Lendo AI didn't return a message. Please try again." };
    return {
      ok: true,
      message: out,
      missing: missingDetails(message, out),
      added: addedNumbers(message, out),
      timing: timingProblems(message, out, language),
      toneUsed: tone,
      toneReason: auto ? picked.reason : null,
    };
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[rewriteMessage]", err);
    return { ok: false, error: "Lendo AI hit an unexpected problem. Please try again." };
  }
}
