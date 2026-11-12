import { db } from "@/lib/db";
import { toBusinessDate, formatDate } from "@/lib/dates";
import { aiChat } from "@/lib/ai/client";
import { LendoData, runLendoTool } from "@/lib/ai/lendo-tools";

// Daily briefing: plain code gathers the facts; Lendo AI writes them up.
// Saved once per day and language, so dashboards don't re-run it.

export type BriefingLang = "en" | "sw";
const KEY_PREFIX = "ai_briefing:";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function briefingFacts() {
  const data = new LendoData();
  const today = toBusinessDate(new Date());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = `${iso(today).slice(0, 8)}01`;
  const run = async (name: string, args: object) =>
    JSON.parse(await runLendoTool(name, JSON.stringify(args), data));

  const [dueSoon, late, paidYesterday, month] = await Promise.all([
    run("loans_due_soon", { days: 3 }),
    run("late_loans", {}),
    run("recent_payments", { from: iso(yesterday), to: iso(yesterday) }),
    run("business_totals", { from: monthStart, to: iso(today) }),
  ]);
  type Due = { in_days: number };
  type Late = { customer: string; days_late: number; owes_now: number; overdue_now: number };
  const lateList = Array.isArray(late) ? (late as Late[]) : [];
  return {
    today: formatDate(today, "EEEE d MMM yyyy"),
    due_today: (dueSoon as Due[]).filter((d) => d.in_days === 0),
    due_next_3_days: (dueSoon as Due[]).filter((d) => d.in_days > 0),
    late_now: {
      people: new Set(lateList.map((l) => l.customer)).size,
      loans: lateList.length,
      total_overdue_now: lateList.reduce((s, l) => s + l.overdue_now, 0),
      total_to_clear: lateList.reduce((s, l) => s + l.owes_now, 0),
      list: lateList.slice(0, 10),
    },
    just_became_late: lateList.filter((l) => l.days_late <= 3),
    paid_yesterday: paidYesterday,
    this_month_so_far: month,
  };
}

function prompt(lang: BriefingLang) {
  return `You write the morning briefing for the owner of Lendo, a small lending business in Tanzania. You get today's facts as JSON.

Write 4 to 7 short bullet points, most urgent first:
1. Who to chase today (late loans — longest late and biggest amounts first; mention anyone who just became late). For each: name, days late, and the amount overdue now ("overdue_now"); the whole balance ("owes_now") only as "to clear".
2. Payments due today, then in the next 3 days (name, "minimum_due"; say "full balance" when final_round is true).
3. Money received yesterday (total and who paid).
4. This month so far: money received and profit (interest).
Skip any point with nothing in it. Count people and loans separately (one person can have several loans). Use names and amounts exactly as in the facts — never invent or estimate. Money as "TSh 1,250,000".
Write in ${lang === "sw" ? "simple, natural Kiswahili" : "simple English"}. Start every line with "• ". No heading, no closing remarks.`;
}

export async function writeBriefing(lang: BriefingLang): Promise<string> {
  const facts = await briefingFacts();
  const res = await aiChat({
    effort: "none",
    maxTokens: 1200,
    messages: [
      { role: "system", content: prompt(lang) },
      { role: "user", content: JSON.stringify(facts) },
    ],
  });
  return res.content.trim();
}

export type SavedBriefing = { text: string; at: string };

function keyFor(lang: BriefingLang) {
  return `${KEY_PREFIX}${iso(toBusinessDate(new Date()))}:${lang}`;
}

export async function loadBriefing(lang: BriefingLang): Promise<SavedBriefing | null> {
  const row = await db.setting.findUnique({ where: { key: keyFor(lang) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SavedBriefing;
  } catch {
    return null;
  }
}

export async function saveBriefing(lang: BriefingLang, text: string): Promise<SavedBriefing> {
  const key = keyFor(lang);
  const saved: SavedBriefing = { text, at: new Date().toISOString() };
  await db.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(saved) },
    update: { value: JSON.stringify(saved) },
  });
  // Keep only today's briefings.
  await db.setting.deleteMany({
    where: { key: { startsWith: KEY_PREFIX, not: { startsWith: key.slice(0, KEY_PREFIX.length + 10) } } },
  });
  return saved;
}

/** Forget today's saved briefings (after money moves) so the next view is fresh. */
export async function clearBriefingCache(): Promise<void> {
  try {
    await db.setting.deleteMany({ where: { key: { startsWith: KEY_PREFIX } } });
  } catch (err) {
    console.error("[clearBriefingCache]", err);
  }
}
