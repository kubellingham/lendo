import { describe, it, expect } from "vitest";
import { parseStatementReply, statementPeriod, verifyDirections } from "@/lib/ai/statement";
import { reconcile } from "@/lib/ai/reconcile";

// Haiku 5.5's real reply for page 1 of the CRDB statement (rows 4 and 5 have
// the wrong direction on purpose: the balance check must fix them).
const PAGE1 = `[
{"sn":1,"date":"2026-10-29","amount":275000,"balance":999230,"dir":"in","name":"Noel Ngereza","phone":"AB17932560591622349355","note":"Marejesho N/A","ref":"1a18663f2b5278fe","kind":"payment_in"},
{"sn":2,"date":"2026-10-27","amount":150000,"balance":724230,"dir":"in","name":"Shafii Rugine","phone":"255718909011","note":null,"ref":"1a17f14e4f027a13","kind":"payment_in"},
{"sn":3,"date":"2026-10-26","amount":600000,"balance":574230,"dir":"out","name":"Kathleen Paul Kube","phone":null,"note":"deni","ref":"1a1766faae121b55","kind":"internal"},
{"sn":4,"date":"2026-10-26","amount":1500,"balance":1174230,"dir":"in","name":"Kathleen Paul Kube","phone":null,"note":"deni","ref":"1a1766faae121b55","kind":"fee"},
{"sn":5,"date":"2026-10-26","amount":270,"balance":1175730,"dir":"in","name":"Kathleen Paul Kube","phone":null,"note":"deni","ref":"1a1766faae121b55","kind":"fee"},
{"sn":6,"date":"2026-10-26","amount":130000,"balance":1176000,"dir":"out","name":"Violet","phone":null,"note":"deni N/A","ref":"1a1766cbe02d2a45","kind":"loan_out"},
{"sn":7,"date":"2026-10-26","amount":1300000,"balance":1306000,"dir":"in","name":"Glory Greyson Muiyanza","phone":"40510000644","note":null,"ref":"1a173fd07409cb65","kind":"payment_in"},
{"sn":8,"date":"2026-10-24","amount":370000,"balance":6000,"dir":"out","name":"Violet","phone":null,"note":"deni N/A","ref":"1a16ec167a10fbe9","kind":"loan_out"},
{"sn":9,"date":"2026-10-24","amount":80000,"balance":376000,"dir":"out","name":"Violet","phone":null,"note":"deni N/A","ref":"1a16dae3dc23bbee","kind":"loan_out"},
{"sn":10,"date":"2026-10-23","amount":20000,"balance":456000,"dir":"in","name":"Someone","phone":null,"note":null,"ref":"x10","kind":"other_in"}
]`;

describe("statement reading", () => {
  const txns = verifyDirections(parseStatementReply(PAGE1));

  it("parses rows and cleans N/A from notes", () => {
    expect(txns).toHaveLength(10);
    expect(txns[0].note).toBe("Marejesho");
    expect(txns[5].note).toBe("deni");
  });

  it("fixes directions from the running balance", () => {
    expect(txns.find((t) => t.sn === 4)!.dir).toBe("out"); // AI said in
    expect(txns.find((t) => t.sn === 5)!.dir).toBe("out");
    expect(txns.find((t) => t.sn === 1)!.dir).toBe("in");
    expect(txns.find((t) => t.sn === 8)!.dir).toBe("out");
    expect(txns.every((t) => t.sn === 10 || t.verified)).toBe(true);
  });

  it("finds the statement period", () => {
    expect(statementPeriod("Statement Period\n2026-07-29 to 2026-10-29")).toEqual({
      from: "2026-07-29",
      to: "2026-10-29",
    });
  });

  it("reconciles against Lendo records", () => {
    const { items, lendoOnly } = reconcile(
      txns,
      [
        // Noel's payment recorded a day later, same amount → recorded
        { id: "p1", loanId: "l1", loanRef: "LND-AAA111", amount: 275000, paidOn: "2026-10-30", method: "BANK", reference: null, customerName: "Noel Ngereza" },
        // Recorded as bank but not on the statement
        { id: "p2", loanId: "l2", loanRef: "LND-BBB222", amount: 99000, paidOn: "2026-10-01", method: "BANK", reference: null, customerName: "Juma" },
      ],
      [
        // Violet's 370,000 matched by bank reference
        { id: "l9", ref: "LND-CCC333", amount: 370000, givenOn: "2026-10-24", reference: "1a16ec167a10fbe9", customerName: "Violet M." },
      ],
      { from: "2026-07-29", to: "2026-10-29" },
    );
    const status = (sn: number) => items.find((i) => i.txn.sn === sn)!.status;
    expect(status(1)).toBe("recorded");
    expect(status(2)).toBe("missing_payment"); // Shafii not in Lendo
    expect(status(3)).toBe("ignored"); // own transfer
    expect(status(4)).toBe("ignored"); // fee
    expect(status(8)).toBe("recorded");
    expect(items.find((i) => i.txn.sn === 8)!.matched!.by).toBe("reference");
    expect(status(6)).toBe("missing_loan");
    expect(status(10)).toBe("other");
    expect(lendoOnly.map((p) => p.id)).toEqual(["p2"]);
  });
});
