import { describe, it, expect } from "vitest";
import { addedNumbers, autoTone, kindOf, missingDetails, mustKeep, timingProblems } from "@/lib/ai/rewrite";

const ORIGINAL = `Hi Neema Swai,

We noticed your Lendo loan payment of *TSh 920,000* was due on 01 Nov 2026 and is now *10 day(s) overdue*.

• Loan ref: LND-B09R29
• Outstanding balance: TSh 800,000

*How to pay*
• Bank: CRDB BANK
• Account name: Kathleen Kube
• Account number: 10327855568`;

// Haiku 5.5's real Kiswahili rewrite (firm tone).
const SWAHILI = `Habari Neema,

Tumeona kwamba malipo yako ya mkopo wa Lendo ya *TSh 920,000* yalitakiwa kulipwa tarehe 01 Nov 2026 na sasa yamechelewa *siku 10*.

• Kumbukumbu ya mkopo: LND-B09R29
• Salio linalobaki: TSh 800,000

*Jinsi ya kulipa*
• Benki: CRDB BANK
• Jina la akaunti: Kathleen Kube
• Namba ya akaunti: 10327855568`;

describe("rewrite safety check", () => {
  it("lists the details that must survive", () => {
    expect(mustKeep(ORIGINAL)).toEqual(
      expect.arrayContaining(["920000", "2026", "LND-B09R29", "800000", "10327855568"]),
    );
  });

  it("passes the real Kiswahili rewrite", () => {
    expect(missingDetails(ORIGINAL, SWAHILI)).toEqual([]);
  });

  it("catches a changed amount or a dropped account number", () => {
    const bad = SWAHILI.replace("920,000", "92,000").replace("10327855568", "");
    expect(missingDetails(ORIGINAL, bad)).toEqual(["920000", "10327855568"]);
  });
});

describe("auto tone", () => {
  it("is never firm for a reminder, receipt or other message", () => {
    expect(autoTone({ firstName: "A", score: 100, latePayments: 0, daysLateNow: 0 }, "reminder").tone).toBe("gentle");
    expect(autoTone({ firstName: "A", score: 40, latePayments: 5, daysLateNow: 0 }, "reminder").tone).toBe("normal");
    expect(autoTone({ firstName: "A", score: 40, latePayments: 5, daysLateNow: 0 }, "receipt").tone).toBe("normal");
  });

  it("is firm only for long-overdue or high-risk overdue messages", () => {
    expect(autoTone({ firstName: "A", score: 72, latePayments: 2, daysLateNow: 10 }, "overdue").tone).toBe("normal");
    expect(autoTone({ firstName: "A", score: 60, latePayments: 3, daysLateNow: 40 }, "overdue").tone).toBe("firm");
    expect(autoTone({ firstName: "A", score: 45, latePayments: 0, daysLateNow: 3 }, "overdue").tone).toBe("firm");
  });

  it("knows each template's kind", () => {
    expect(kindOf("reminder_3d")).toBe("reminder");
    expect(kindOf("due_today")).toBe("reminder");
    expect(kindOf("overdue")).toBe("overdue");
    expect(kindOf("payment_received")).toBe("receipt");
    expect(kindOf(undefined)).toBe("other");
  });
});

describe("the bug from 12 Nov: 'tomorrow' became 'siku 3'", () => {
  const original = `Hi Stephen 👋

Your Lendo loan payment is due *tomorrow*, on 13 Nov 2026. Please arrange payment on time to keep your account in good standing.

• Loan ref: LND-TKCS7M
• Amount to pay: *TSh 230,000* (final round — the full balance must be paid)`;

  it("flags an invented number of days and the lost 'tomorrow'", () => {
    const bad = `Habari Stephen 👋

Malipo ya mkopo wako wa Lendo yanatakiwa baada ya *siku 3*, tarehe 13 Nov 2026.

• Namba ya mkopo: LND-TKCS7M
• Kiasi cha kulipa: *TSh 230,000* (awamu ya mwisho — salio lote lazima lilipwe)`;
    expect(addedNumbers(original, bad)).toEqual(["3"]);
    expect(timingProblems(original, bad, "sw")).toEqual(["“tomorrow (kesho)” is missing"]);
    expect(missingDetails(original, bad)).toEqual([]);
  });

  it("passes a correct Kiswahili rewrite", () => {
    const good = `Habari Stephen 👋

Malipo ya mkopo wako wa Lendo yanatakiwa *kesho*, tarehe 13 Nov 2026.

• Namba ya mkopo: LND-TKCS7M
• Kiasi cha kulipa: *TSh 230,000* (awamu ya mwisho — salio lote lazima lilipwe)`;
    expect(addedNumbers(original, good)).toEqual([]);
    expect(timingProblems(original, good, "sw")).toEqual([]);
    expect(missingDetails(original, good)).toEqual([]);
  });

  it("treats 01 and 1 as the same day", () => {
    expect(missingDetails("due on 01 Nov 2026", "tarehe 1 Novemba 2026")).toEqual([]);
  });
});

// Real Claude Haiku 5.5 rewrites (via AIML API) with the hardened prompt.
describe("real Haiku rewrites pass every check", () => {
  const cases: { lang: "sw"; original: string; rewritten: string }[] = [
    {
      lang: "sw",
      original: `Hi Stephen Budoya 👋

Your Lendo loan payment is due *tomorrow*, on 13 Nov 2026. Please arrange payment on time to keep your account in good standing.

*Payment details*
• Loan ref: LND-TKCS7M
• Amount to pay: *TSh 230,000* (final round — the full balance must be paid)

*How to pay*
• Bank: CRDB BANK
• Account name: Kathleen Kube
• Account number: 10327855568`,
      rewritten: `Habari Stephen 👋

Malipo yako ya mkopo wa Lendo yanatakiwa *kesho*, tarehe 13 Nov 2026. Tafadhali hakikisha unalipa kwa wakati ili akaunti yako ibaki salama.

*Maelezo ya malipo*
• Kumbukumbu ya mkopo: LND-TKCS7M
• Kiasi cha kulipa: *TSh 230,000* (awamu ya mwisho — salio lote lazima lilipwe)

*Jinsi ya kulipa*
• Benki: CRDB BANK
• Jina la akaunti: Kathleen Kube
• Namba ya akaunti: 10327855568`,
    },
    {
      lang: "sw",
      original: `Hi Stephen Budoya,

We noticed your Lendo loan payment for round 2 of 3 was due on 14 Oct 2026 and is now *10 day(s) overdue*.

• Loan ref: LND-TKCS7M
• Minimum to pay: *TSh 30,000* (interest for round 2 of 3)
• To clear the whole loan: TSh 230,000

*How to pay*
• Bank: CRDB BANK
• Account name: Kathleen Kube
• Account number: 10327855568`,
      rewritten: `Habari Stephen,

Tunakukumbusha kuwa malipo yako ya raundi ya 2 kati ya 3 ya mkopo wa Lendo yalipaswa kulipwa tarehe 14 Oct 2026 na sasa *yamechelewa siku 10*.

• Kumbukumbu ya mkopo: LND-TKCS7M
• Kiasi cha chini cha kulipa: *TSh 30,000* (riba ya raundi ya 2 kati ya 3)
• Kulipa mkopo wote: TSh 230,000

*Jinsi ya kulipa*
• Benki: CRDB BANK
• Jina la akaunti: Kathleen Kube
• Namba ya akaunti: 10327855568`,
    },
  ];
  it.each(cases)("no missing or invented details", ({ lang, original, rewritten }) => {
    expect(missingDetails(original, rewritten)).toEqual([]);
    expect(addedNumbers(original, rewritten)).toEqual([]);
    expect(timingProblems(original, rewritten, lang)).toEqual([]);
  });
});
