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
  type Late = { customer: string; days_late: number; owes_now: number; overdue_now: number; rounds_overdue?: number[] };
  const lateList = Array.isArray(late) ? (late as Late[]) : [];
  // Per-person totals, worked out here so the AI never adds numbers itself.
  const byPerson = new Map<string, { customer: string; loans: number; most_days_late: number; rounds_unpaid: number; overdue_now: number; to_clear: number }>();
  for (const l of lateList) {
    const p = byPerson.get(l.customer) ?? { customer: l.customer, loans: 0, most_days_late: 0, rounds_unpaid: 0, overdue_now: 0, to_clear: 0 };
    p.loans++;
    p.most_days_late = Math.max(p.most_days_late, l.days_late);
    p.rounds_unpaid += l.rounds_overdue?.length ?? 1;
    p.overdue_now += l.overdue_now;
    p.to_clear += l.owes_now;
    byPerson.set(l.customer, p);
  }
  return {
    today: formatDate(today, "EEEE d MMM yyyy"),
    due_today: (dueSoon as Due[]).filter((d) => d.in_days === 0),
    due_next_3_days: (dueSoon as Due[]).filter((d) => d.in_days > 0),
    late_now: {
      people: new Set(lateList.map((l) => l.customer)).size,
      loans: lateList.length,
      total_overdue_now: lateList.reduce((s, l) => s + l.overdue_now, 0),
      total_to_clear: lateList.reduce((s, l) => s + l.owes_now, 0),
      by_person: [...byPerson.values()].sort((a, b) => b.most_days_late - a.most_days_late || b.overdue_now - a.overdue_now),
    },
    just_became_late: lateList.filter((l) => l.days_late <= 3),
    paid_yesterday: paidYesterday,
    this_month_so_far: month,
  };
}

function prompt(lang: BriefingLang) {
  const sw = lang === "sw";
  return `You write the morning briefing for the owner of Lendo, a small lending business in Tanzania. You get today's facts as JSON.

Write 4 to 7 short bullet points, most urgent first:
1. One summary line for late payments, using late_now exactly: how many people and loans are late, and total_overdue_now.
2. Who to chase today: one line per person from late_now.by_person (already in order, totals already added up); at most 4 people, then "and N more" for the rest. For each: name, most_days_late, overdue_now, and — if loans > 1 or rounds_unpaid > 1 — how many loans / unpaid rounds. Mention "to_clear" only as the amount to clear, and only if useful. Mention anyone in just_became_late.
3. Payments due today, then in the next 3 days (name, "minimum_due"; say "full balance" when final_round is true).
4. Money received yesterday (total and who paid).
5. This month so far: money received and profit (interest).
Skip any point with nothing in it — leave it out completely, never write "none" or "hakuna". Count people and loans separately (one person can have several loans). Use names and amounts exactly as in the facts — never invent, estimate or add numbers up yourself. Money as "TSh 1,250,000".
${
  sw
    ? `Write in simple, natural Kiswahili as spoken in Tanzania — no English words. Use these terms: overdue now = "inadaiwa sasa"; days late = "amechelewa siku N"; to clear the loan = "kumaliza mkopo"; loan = "mkopo"; round = "raundi"; final round, full balance = "raundi ya mwisho — salio lote"; due tomorrow = "kesho"; profit = "faida (riba)".`
    : "Write in simple English."
}
Start every line with "• ". No heading, no closing remarks.`;
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
