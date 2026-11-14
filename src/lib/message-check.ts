// ---------------------------------------------------------------------------
// Checks every number in a customer message against the loan's records.
// No server imports — the Send WhatsApp dialog runs it live as staff edit.
//
// Handles amounts ("TSh 224,250", "224250"), dates in English or Kiswahili
// ("24 Nov 2026", "24 Novemba 2026", "Nov 24, 2026", "24/11/2026", "24 Nov"),
// loan references (LND-X6RQG0), account and phone numbers, and small numbers
// (rounds, days, the interest rate).
// ---------------------------------------------------------------------------

export type FactKind = "amount" | "date" | "number" | "ref" | "account" | "text";

/** One thing Lendo knows about the loan, shown to the AI and used for checking. */
export type Fact = {
  /** Plain-language label, e.g. "Amount to clear the loan now". */
  label: string;
  /** How it's written for people, e.g. "TSh 224,250" or "24 Nov 2026". */
  value: string;
  kind: FactKind;
  /** Machine value for checking: digits for amounts/numbers/accounts, ISO for dates, the ref itself. */
  key: string;
  /** Section it belongs to, for display. */
  group?: string;
};

export type NumberCheck = {
  /** As written in the message. */
  text: string;
  status: "ok" | "note" | "unknown";
  /** What it matched in the records. */
  label?: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, machi: 3,
  apr: 4, april: 4, aprili: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, agosti: 8,
  sep: 9, sept: 9, september: 9, septemba: 9,
  oct: 10, october: 10, okt: 10, oktoba: 10,
  nov: 11, november: 11, novemba: 11,
  dec: 12, december: 12, des: 12, desemba: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Digits only, without leading zeros ("TSh 0224,250" → "224250"). */
export function numKey(s: string): string {
  return s.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

/** Phone / account numbers compare on their last 9 digits (0754… = +255754…). */
const tail9 = (s: string) => s.replace(/\D/g, "").slice(-9);

type Found = {
  text: string;
  kind: "date" | "dayMonth" | "ref" | "account" | "number";
  key: string;
  /** Set for "round 2" / "raundi ya 2" / "awamu ya 2". */
  isRound?: boolean;
};

const ROUND_BEFORE = /(?:\brounds?|\braundi|\bawamu|\bmzunguko)(?:\s+(?:ya|wa|no\.?|number))?\s*$/i;

/** Pull every date, reference, account/phone number and plain number out of a text. */
export function extractNumbers(text: string): Found[] {
  const found: Found[] = [];
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => Found | null) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const f = fn(m);
      if (f) found.push(f);
      return f ? " " : m[0];
    });
  };
  // 24 Nov 2026 / 24th of November, 2026 / 24 Novemba 2026
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?,?\\s+(\\d{4})\\b`, "gi"), (m) => {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? { text: m[0], kind: "date", key: isoOf(+m[3], mo, +m[1]) } : null;
  });
  // Nov 24, 2026
  take(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), (m) => {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? { text: m[0], kind: "date", key: isoOf(+m[3], mo, +m[2]) } : null;
  });
  // 2026-11-24
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => ({ text: m[0], kind: "date", key: isoOf(+m[1], +m[2], +m[3]) }));
  // 24/11/2026 or 24.11.2026 (day first, as written in Tanzania)
  take(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, (m) => ({ text: m[0], kind: "date", key: isoOf(+m[3], +m[2], +m[1]) }));
  // 24 Nov (no year)
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?`, "gi"), (m) => {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? { text: m[0], kind: "dayMonth", key: `${pad(mo)}-${pad(+m[1])}` } : null;
  });
  // Loan references
  take(/\bLND-[A-Z0-9]{6}\b/gi, (m) => ({ text: m[0], kind: "ref", key: m[0].toUpperCase() }));
  // Phone / account numbers: + or spaced groups, or long digit runs (9+ digits, no commas)
  take(/(?:\+\d{1,3}[\s-]?)?\b\d{2,4}(?:[\s-]\d{2,4}){2,}\b|\b\d{9,}\b/g, (m) => ({
    text: m[0].trim(),
    kind: "account",
    key: tail9(m[0]),
  }));
  // Everything else: amounts and small numbers
  for (const m of rest.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/[,.]$/, "");
    const key = numKey(raw.split(".")[0]);
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
    if (key) found.push({ text: raw, kind: "number", key, ...(ROUND_BEFORE.test(before) ? { isRound: true } : {}) });
  }
  return found;
}

/**
 * Check a message against the facts. Numbers that only appear in the staff
 * member's own note are marked "note" (they chose to say it, but it isn't in
 * the records); anything else not in the records is "unknown".
 */
export function checkMessage(message: string, facts: Fact[], staffNote = ""): NumberCheck[] {
  // Each value can mean several things (24 Nov = round 3 due date = final due date).
  const byNumber = new Map<string, string[]>();
  const byDate = new Map<string, string[]>();
  const byDayMonth = new Map<string, string[]>();
  const byRef = new Map<string, string[]>();
  const byAccount = new Map<string, string[]>();
  const put = (m: Map<string, string[]>, k: string, label: string) => {
    const list = m.get(k) ?? [];
    if (!list.includes(label)) m.set(k, [...list, label]);
  };
  for (const f of facts) {
    if (f.kind === "date") {
      put(byDate, f.key, f.label);
      put(byDayMonth, f.key.slice(5), f.label);
    } else if (f.kind === "ref") put(byRef, f.key.toUpperCase(), f.label);
    else if (f.kind === "account") put(byAccount, tail9(f.key), f.label);
    else if (f.kind === "amount" || f.kind === "number") put(byNumber, f.key, f.label);
  }
  const show = (labels?: string[]) =>
    labels?.length ? labels.slice(0, 2).join(" · ") + (labels.length > 2 ? ` (+${labels.length - 2} more)` : "") : undefined;
  // Rounds the loan has (from labels like "Round 3 due date").
  const rounds = new Set(
    facts.flatMap((f) => [...f.label.matchAll(/\bRound (\d+)\b/g)].map((m) => m[1])),
  );
  const noteKeys = new Set(extractNumbers(staffNote).map((n) => `${n.kind}:${n.key}`));

  const out: NumberCheck[] = [];
  const seen = new Set<string>();
  for (const n of extractNumbers(message)) {
    const id = `${n.kind}:${n.key}${n.isRound ? ":round" : ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (n.isRound) {
      out.push(
        rounds.has(n.key)
          ? { text: `${n.text}`, status: "ok", label: `Round ${n.key} of this loan` }
          : { text: `round ${n.text}`, status: "unknown" },
      );
      continue;
    }
    const label = show(
      n.kind === "date"
        ? byDate.get(n.key)
        : n.kind === "dayMonth"
          ? byDayMonth.get(n.key)
          : n.kind === "ref"
            ? byRef.get(n.key)
            : n.kind === "account"
              ? byAccount.get(n.key) ?? byNumber.get(numKey(n.text))
              : byNumber.get(n.key),
    );
    if (label) out.push({ text: n.text, status: "ok", label });
    else if (noteKeys.has(id)) out.push({ text: n.text, status: "note", label: "from your note, but not in this loan's records" });
    else out.push({ text: n.text, status: "unknown" });
  }
  return out;
}
