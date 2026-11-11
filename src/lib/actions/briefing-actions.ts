"use server";

import { getCurrentUser } from "@/lib/rbac";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { loadBriefing, saveBriefing, writeBriefing, type BriefingLang, type SavedBriefing } from "@/lib/ai/briefing";

const ALLOWED = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];

export type BriefingResult = ({ ok: true } & SavedBriefing) | { ok: false; error: string };

/** Today's briefing — from the daily cache unless `refresh` is set. */
export async function getBriefing(lang: BriefingLang, refresh = false): Promise<BriefingResult> {
  const user = await getCurrentUser();
  if (!user || !ALLOWED.includes(user.role)) return { ok: false, error: "Not available." };
  if (!aiConfigured()) return { ok: false, error: "Lendo AI isn't switched on." };
  const language: BriefingLang = lang === "sw" ? "sw" : "en";

  if (!refresh) {
    const cached = await loadBriefing(language);
    if (cached) return { ok: true, ...cached };
  }
  try {
    const text = await writeBriefing(language);
    if (!text) return { ok: false, error: "Lendo AI didn't return a briefing. Try refresh." };
    return { ok: true, ...(await saveBriefing(language, text)) };
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[getBriefing]", err);
    return { ok: false, error: "Couldn't prepare today's briefing." };
  }
}
