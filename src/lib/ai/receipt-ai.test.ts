import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSystemPrompt, parseReceiptReply, readReceipt } from "@/lib/ai/receipt-ai";
import { matchScore, nameWords, paymentHint } from "@/lib/ai/match";

const BUSINESS = { accountName: "Kathleen Kube", bank: "CRDB BANK", accountNumber: "10327855568" };

// The real reply Claude Haiku 5.5 gave (via AIML API) for the CRDB receipt.
const REAL_REPLY =
  '{"kind":"LOAN_GIVEN","amount":1000000,"currency":"TZS","date":"2026-11-09","time":"18:47","counterpartyName":"Athanas Anthony Nyangusi","counterpartyAccount":"0152664297200","reference":"1a1c0fe323c5ea45","description":"Mkopo","provider":"CRDB BANK","method":"BANK","transactionStatus":"Successful Completion","confidence":"high","notes":"Date read as day/month/year."}';

describe("parseReceiptReply", () => {
  it("parses the model's JSON", () => {
    const r = parseReceiptReply(REAL_REPLY)!;
    expect(r.kind).toBe("LOAN_GIVEN");
    expect(r.amount).toBe(1000000);
    expect(r.date).toBe("2026-11-09");
    expect(r.counterpartyName).toBe("Athanas Anthony Nyangusi");
    expect(r.reference).toBe("1a1c0fe323c5ea45");
  });

  it("tolerates code fences, string amounts and bad values", () => {
    const r = parseReceiptReply(
      '```json\n{"kind":"SOMETHING","amount":"TZS 75,000.00","date":"16/08/2026","method":"VODA","confidence":"?","counterpartyName":"  "}\n```',
    )!;
    expect(r.kind).toBe("UNKNOWN");
    expect(r.amount).toBe(75000);
    expect(r.date).toBeNull(); // not YYYY-MM-DD → never guessed
    expect(r.method).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.counterpartyName).toBeNull();
  });

  it("returns null for non-JSON", () => {
    expect(parseReceiptReply("Sorry, I can't read that.")).toBeNull();
  });
});

describe("buildSystemPrompt", () => {
  it("names the business account and the day/month/year rule", () => {
    const p = buildSystemPrompt(BUSINESS);
    expect(p).toContain("10327855568");
    expect(p).toContain('"Kathleen Kube"');
    expect(p).toContain("09/11/2026 is 9 November 2026");
  });
});

describe("readReceipt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("calls AIML API with the image and Claude Haiku 5.5", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: REAL_REPLY } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await readReceipt("data:image/jpeg;base64,AAAA", BUSINESS);
    expect(r.kind).toBe("LOAN_GIVEN");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.aimlapi.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("anthropic/claude-haiku-5.5");
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAAA" },
    });
  });

  it("explains a rejected key and running out of credits", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "bad");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(readReceipt("data:image/jpeg;base64,AAAA", BUSINESS)).rejects.toThrow(/key was rejected/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 402 })));
    await expect(readReceipt("data:image/jpeg;base64,AAAA", BUSINESS)).rejects.toThrow(/out of credits/);
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "");
    await expect(readReceipt("data:image/jpeg;base64,AAAA", BUSINESS)).rejects.toThrow(/isn't switched on/);
  });
});

describe("customer matching", () => {
  it("normalises names", () => {
    expect(nameWords("ALOYCE  MASHOKO.")).toEqual(["aloyce", "mashoko"]);
  });

  it("scores name and phone matches", () => {
    const exact = matchScore(
      { name: "Athanas Anthony Nyangusi", account: "0152664297200" },
      { fullName: "Athanas Anthony Nyangusi", phone: "+255712000000" },
    );
    expect(exact.score).toBe(1);
    const partial = matchScore(
      { name: "ALOYCE MASHOKO", account: "255750456561" },
      { fullName: "Aloyce J. Mashoko", phone: "+255750456561" },
    );
    expect(partial.reasons).toContain("Same phone number");
    expect(partial.score).toBeGreaterThan(0.9);
    const none = matchScore(
      { name: "Grace Mushi", account: null },
      { fullName: "Juma Kassim", phone: "+255715000001" },
    );
    expect(none.score).toBe(0);
  });

  it("explains what a payment covers", () => {
    const loan = { interestOnly: 150000, settlement: 1150000, cycle: 2 };
    expect(paymentHint(150000, loan)).toBe("Matches the interest for round 2");
    expect(paymentHint(1150000, loan)).toBe("Matches the full amount to clear this loan");
    expect(paymentHint(50000, loan)).toContain("part payment");
    expect(paymentHint(400000, loan)).toContain("part of the principal");
  });
});
