import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate } from "@/lib/dates";
import { buildLoanFacts, composePrompt, factsText, type FactsLoan } from "@/lib/ai/custom-message";
import { checkMessage, extractNumbers } from "@/lib/message-check";

// Like Glory's loan: TSh 2,000,000 given 26 Aug 2026, rounds due 25 Sep, 25 Oct, 24 Nov.
// She paid round 1's interest, then a big payment in round 2 — round 3 now needs TSh 224,250.
function gloryLoan(): FactsLoan {
  const s = generateSchedule({ principal: 2000000, disbursedAt: parseIsoDate("2026-08-26") });
  const installments = s.installments.map((i) => ({
    id: `r${i.cycleNumber}`,
    cycleNumber: i.cycleNumber,
    dueDate: i.dueDate,
    expectedInterest: new Decimal(i.expectedInterest),
    expectedPrincipalAtThisCycle: new Decimal(i.expectedPrincipalAtThisCycle),
    status: "PENDING" as const,
  }));
  const pay = (id: string, amount: number, on: string, round: number) => ({
    id,
    amount: new Decimal(amount),
    installmentId: `r${round}`,
    paidAt: parseIsoDate(on),
    createdAt: parseIsoDate(on),
    method: "BANK",
  });
  return {
    id: "cmglory0000x6rqg0",
    principal: new Decimal(2000000),
    status: "ACTIVE",
    interestRatePct: 15,
    cyclesAllowed: 3,
    disbursedAt: s.disbursedAt,
    dueAt: s.dueAt,
    customer: { fullName: "Glory Malingumu" },
    installments,
    payments: [pay("p1", 300000, "2026-09-20", 1), pay("p2", 2105000, "2026-10-20", 2)],
  } as FactsLoan;
}

const PAY = { bank: "CRDB BANK", accountName: "Kathleen Kube", accountNumber: "10327855568" };
const BRAND = { name: "Lendo", phone: "+255 786 776 677" };
const NOW = new Date("2026-11-14T08:00:00Z");
const facts = buildLoanFacts(gloryLoan(), PAY, BRAND, NOW);
const val = (label: string) => facts.find((f) => f.label === label)?.value;

describe("buildLoanFacts — what Lendo AI is told", () => {
  it("has where the loan stands now (matches the Send WhatsApp screen)", () => {
    expect(val("Loan reference")).toBe("LND-X6RQG0");
    expect(val("Current round")).toBe("3");
    expect(val("Round 3 due date")).toBe("24 Nov 2026");
    expect(val("Days until it is due")).toBe("10");
    expect(val("Amount to clear the whole loan now (balance + interest)")).toBe("TSh 224,250");
    expect(val("Loan balance still owed (without interest)")).toBe("TSh 195,000");
    expect(val("Interest still owed for round 3")).toBe("TSh 29,250");
    expect(val("What must be paid")).toBe("the full balance (final round)");
  });
  it("explains how each payment was used — interest first, then the balance", () => {
    expect(val("Payment 1 amount")).toBe("TSh 300,000");
    expect(val("Payment 1: part that paid interest (round 1)")).toBe("TSh 300,000");
    expect(val("Payment 1: part that reduced the loan balance")).toBe("TSh 0");
    expect(val("Payment 2 amount")).toBe("TSh 2,105,000");
    expect(val("Payment 2: part that paid interest (round 2)")).toBe("TSh 300,000");
    expect(val("Payment 2: part that reduced the loan balance")).toBe("TSh 1,805,000");
    expect(val("Total paid so far")).toBe("TSh 2,405,000");
    expect(val("Total interest paid so far")).toBe("TSh 600,000");
  });
  it("gives the AI grouped, readable facts and the tone/language", () => {
    const text = factsText(facts);
    expect(text).toContain("Payment 2:\n- Payment 2 date: 20 Oct 2026");
    const p = composePrompt({ language: "sw", tone: "warm", facts, now: NOW });
    expect(p).toContain("Address Glory by first name");
    expect(p).toContain("riba");
    expect(p).toContain("warm, friendly");
    expect(composePrompt({ language: "en", tone: "firm", facts, now: NOW })).toContain("no threats");
  });
});

describe("checkMessage — every number against the records", () => {
  it("passes a correct Kiswahili message", () => {
    const msg = `Habari Glory 👋
Tarehe 20 Okt 2026 ulilipa *TSh 2,105,000*: TSh 300,000 ililipa riba ya raundi ya 2, na TSh 1,805,000 ilipunguza salio la mkopo.
Sasa salio la mkopo ni TSh 195,000 na riba ya raundi ya 3 ni TSh 29,250.
Ili kumaliza mkopo LND-X6RQG0, lipa *TSh 224,250* kufikia *24 Novemba 2026* (siku 10 zimebaki).
• Benki: CRDB BANK
• Namba ya akaunti: 10327855568
Maswali? Piga +255 786 776 677
— Lendo`;
    const checks = checkMessage(msg, facts);
    expect(checks.filter((c) => c.status !== "ok")).toEqual([]);
    expect(checks.find((c) => c.text === "224,250")?.label).toContain("clear the whole loan");
    expect(checks.find((c) => c.text.startsWith("24 Novemba"))?.label).toBe("Final due date · Round 3 due date");
  });
  it("flags a number that isn't in the records", () => {
    const checks = checkMessage("Please pay TSh 230,000 by 24 Nov.", facts);
    expect(checks).toContainEqual({ text: "230,000", status: "unknown" });
    expect(checks.find((c) => c.text.startsWith("24 Nov"))?.status).toBe("ok"); // no year still matches
  });
  it("flags a wrong date and a wrong loan reference", () => {
    const checks = checkMessage("Loan LND-ABC123 is due on 25 Nov 2026.", facts);
    expect(checks.map((c) => c.status)).toEqual(["unknown", "unknown"]);
  });
  it("marks numbers that came from the staff member's own note", () => {
    const checks = checkMessage("Please pay within 3 days, by 17 Nov 2026.", facts, "ask her to pay within 3 days, 17 Nov");
    expect(checks.find((c) => c.text === "3")?.status).toBe("ok"); // 3 is also the round number
    expect(checks.find((c) => c.text.startsWith("17 Nov"))?.status).toBe("unknown"); // dated note without year → different key
  });
  it("knows a round number by the word before it", () => {
    const checks = checkMessage("Riba ya raundi ya 2 imelipwa; round 3 ni ya mwisho; raundi ya 5 haipo.", facts);
    expect(checks).toEqual([
      { text: "2", status: "ok", label: "Round 2 of this loan" },
      { text: "3", status: "ok", label: "Round 3 of this loan" },
      { text: "round 5", status: "unknown" },
    ]);
  });
  it("reads the different ways dates and numbers get written", () => {
    const keys = extractNumbers("Due Nov 24, 2026 or 24/11/2026 or 2026-11-24; call 0786 776 677; pay 224250").map((n) => `${n.kind}:${n.key}`);
    expect(keys).toEqual([
      "date:2026-11-24",
      "date:2026-11-24",
      "date:2026-11-24",
      "account:786776677",
      "number:224250",
    ]);
  });
});
