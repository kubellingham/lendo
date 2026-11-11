import { describe, it, expect } from "vitest";
import { autoTone, missingDetails, mustKeep } from "@/lib/ai/rewrite";

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
  it("is gentle for a clean record and firm when very late", () => {
    expect(autoTone({ firstName: "A", score: 100, latePayments: 0, daysLateNow: 0 })).toBe("gentle");
    expect(autoTone({ firstName: "A", score: 72, latePayments: 2, daysLateNow: 10 })).toBe("normal");
    expect(autoTone({ firstName: "A", score: 60, latePayments: 3, daysLateNow: 40 })).toBe("firm");
    expect(autoTone({ firstName: "A", score: 45, latePayments: 0, daysLateNow: 0 })).toBe("firm");
  });
});
