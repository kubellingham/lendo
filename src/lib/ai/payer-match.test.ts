import { describe, it, expect } from "vitest";
import { parseReceiptReply, settleDirection } from "@/lib/ai/receipt-ai";
import { accountsMatch, bestLoanFit, matchScore, paymentHint } from "@/lib/ai/match";

const BUSINESS = { accountName: "Kathleen Kube", bank: "CRDB BANK", accountNumber: "10327855568" };

// Noel's CRDB SMS (12 Nov 2026): no name, only a masked sending account.
// "Umetuma TZS 300,000 kutoka AC:01524***2000 kwenda KATHLEEN PAUL KUBE AC: 10327855568 REF: 1a1cf2a8ea19abf2 ..."
// Real Haiku reply before the fix: it understood the direction but still said UNKNOWN.
const REAL_UNKNOWN_REPLY =
  '{"kind":"UNKNOWN","amount":300000,"currency":"TZS","date":"2026-11-12","time":"12:50","counterpartyName":null,"counterpartyAccount":null,"reference":"1a1cf2a8ea19abf2","description":null,"provider":"CRDB BANK","method":"BANK","transactionStatus":null,"confidence":"low","notes":"Likely PAYMENT_RECEIVED, pending the sender name."}';

describe("settleDirection — Lendo decides the direction from the accounts", () => {
  it("money to the business account is a payment received, even with no name", () => {
    const r = parseReceiptReply(
      REAL_UNKNOWN_REPLY.replace('"counterpartyAccount":null', '"counterpartyAccount":null,"fromAccount":"AC:01524***2000","toAccount":"10327855568","toName":"KATHLEEN PAUL KUBE"'),
    )!;
    const s = settleDirection(r, BUSINESS);
    expect(s.kind).toBe("PAYMENT_RECEIVED");
    expect(s.counterpartyAccount).toBe("AC:01524***2000"); // the payer's account is kept for matching
    expect(s.notes).toContain("payment received");
  });

  it("recognises the business by name when the account isn't printed", () => {
    const r = parseReceiptReply('{"kind":"UNKNOWN","amount":5000,"toName":"KATHLEEN PAUL KUBE","fromAccount":"0754123456"}')!;
    expect(settleDirection(r, BUSINESS).kind).toBe("PAYMENT_RECEIVED");
  });

  it("money from the business account is a loan given out", () => {
    const r = parseReceiptReply('{"kind":"PAYMENT_RECEIVED","amount":1000000,"fromAccount":"1032***5568","toAccount":"0152664297200"}')!;
    const s = settleDirection(r, BUSINESS);
    expect(s.kind).toBe("LOAN_GIVEN");
    expect(s.counterpartyAccount).toBe("0152664297200");
  });

  it("never treats the business's own account as the customer's", () => {
    const r = parseReceiptReply('{"kind":"PAYMENT_RECEIVED","amount":1,"counterpartyAccount":"10327855568","toAccount":"10327855568"}')!;
    expect(settleDirection(r, BUSINESS).counterpartyAccount).toBeNull();
  });

  it("leaves a correct reading alone", () => {
    const r = parseReceiptReply('{"kind":"PAYMENT_RECEIVED","amount":30000,"counterpartyName":"Stephen","notes":"ok"}')!;
    const s = settleDirection(r, BUSINESS);
    expect(s.kind).toBe("PAYMENT_RECEIVED");
    expect(s.notes).toBe("ok");
  });
});

describe("accountsMatch — masked account numbers", () => {
  it("matches the same masked account", () => {
    expect(accountsMatch("01524***2000", "AC:01524***2000")).toBe(true);
  });
  it("matches a masked account against the full number", () => {
    expect(accountsMatch("01524***2000", "0152466662000")).toBe(true);
  });
  it("does not match a different account", () => {
    expect(accountsMatch("01524***2000", "01526***2000")).toBe(false);
    expect(accountsMatch("01524***2000", "0152664297200")).toBe(false); // Athanas's account
  });
  it("needs enough visible digits", () => {
    expect(accountsMatch("***2000", "0152462000")).toBe(false);
    expect(accountsMatch("0152", "0152")).toBe(false);
  });
  it("matches full numbers only when identical", () => {
    expect(accountsMatch("10327855568", "10327855568")).toBe(true);
    expect(accountsMatch("10327855568", "10327855569")).toBe(false);
  });
});

describe("matchScore — no name, but a known account", () => {
  const noel = { fullName: "Noel Mushi", phone: "+255700000001", knownAccounts: ["01524***2000"] };
  it("finds the customer who paid from this account before", () => {
    const m = matchScore({ name: null, account: "AC:01524***2000" }, noel);
    expect(m.score).toBeGreaterThanOrEqual(0.7);
    expect(m.reasons).toContain("Has paid from this account before");
  });
  it("does not match someone else", () => {
    const m = matchScore({ name: null, account: "01524***2000" }, { fullName: "Other", phone: "+255700000002" });
    expect(m.score).toBe(0);
  });
  it("a masked account never matches a phone by its digits alone", () => {
    // "01524***2000" has 9 digits once the stars are dropped — must not hit a phone ending 015242000.
    const m = matchScore({ name: null, account: "01524***2000" }, { fullName: "X", phone: "+255015242000" });
    expect(m.reasons).not.toContain("Same phone number");
  });
  it("matches a masked mobile-money number to the customer's phone", () => {
    const m = matchScore({ name: null, account: "0754***456" }, { fullName: "Y", phone: "+255754123456" });
    expect(m.reasons).toContain("Same phone number");
  });
});

describe("bestLoanFit — which of several loans", () => {
  const loans = [
    { minimumDue: 30000, interestOnly: 30000, settlement: 230000, daysUntilDue: 10 },
    { minimumDue: 300000, interestOnly: 300000, settlement: 2300000, daysUntilDue: 20 },
    { minimumDue: 45000, interestOnly: 45000, settlement: 345000, daysUntilDue: -3 },
  ];
  it("prefers the loan expecting exactly this amount", () => {
    expect(bestLoanFit(300000, loans)).toEqual({ index: 1, reason: expect.stringContaining("amount matches") });
  });
  it("otherwise the most overdue / next due", () => {
    expect(bestLoanFit(100000, loans)).toEqual({ index: 2, reason: "it is the most overdue" });
  });
  it("nothing to choose with one loan", () => {
    expect(bestLoanFit(300000, [loans[0]])).toBeNull();
  });
});

describe("paymentHint on the final round", () => {
  it("doesn't call a part payment 'interest' when the full balance is due", () => {
    const final = { interestOnly: 30000, settlement: 230000, cycle: 3, isFinalRound: true };
    expect(paymentHint(30000, final)).toContain("full balance is due");
    expect(paymentHint(230000, final)).toBe("Matches the full amount to clear this loan");
  });
});

describe("real Haiku reply for Noel's SMS after the prompt fix", () => {
  const FIXED_REPLY =
    '{"kind":"PAYMENT_RECEIVED","amount":300000,"currency":"TZS","date":"2026-11-12","time":"12:50","counterpartyName":null,"counterpartyAccount":"01524***2000","fromAccount":"01524***2000","toAccount":"10327855568","toName":"KATHLEEN PAUL KUBE","reference":"1a1cf2a8ea19abf2","description":null,"provider":"CRDB BANK","method":"BANK","transactionStatus":"Umetuma (sent)","confidence":"high","notes":"The phone number 0755197700 is the bank\'s help line and was ignored."}';
  it("is a payment received with the payer's masked account, not the helpline", () => {
    const r = settleDirection(parseReceiptReply(FIXED_REPLY)!, BUSINESS);
    expect(r.kind).toBe("PAYMENT_RECEIVED");
    expect(r.counterpartyAccount).toBe("01524***2000");
    expect(r.amount).toBe(300000);
    expect(r.reference).toBe("1a1cf2a8ea19abf2");
  });
});
