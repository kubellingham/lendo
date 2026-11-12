import { describe, it, expect, vi, afterEach } from "vitest";

// The Ask Lendo loop: model asks for a tool, gets the result, then answers.
vi.mock("@/lib/ai/lendo-tools", () => ({
  LENDO_TOOLS: [{ type: "function", function: { name: "late_loans", description: "", parameters: {} } }],
  LendoData: class {},
  runLendoTool: vi.fn(async () => '[{"customer":"Neema Swai","days_late":10,"owes_now":920000}]'),
}));

import { answerQuestion, buildMessages } from "@/lib/ai/ask-core";

const NOW = new Date("2026-11-12T14:56:00Z"); // 17:56 in Tanzania

describe("answerQuestion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs a lookup, answers, and keeps the data exactly as it was", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "k");
    const replies = [
      { choices: [{ message: { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "late_loans", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
      { choices: [{ message: { content: "Neema Swai amechelewa siku 10." }, finish_reason: "stop" }] },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await answerQuestion(buildMessages([], "Ni nani amechelewa?", NOW), NOW);
    expect(res).toEqual({
      ok: true,
      answer: "Neema Swai amechelewa siku 10.",
      lookups: ["late_loans"],
      snapshot: {
        at: NOW.toISOString(),
        lookups: [{ tool: "late_loans", args: {}, result: [{ customer: "Neema Swai", days_late: 10, owes_now: 920000 }] }],
      },
    });

    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    const toolMsg = second.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("t1");
    expect(toolMsg.content).toContain("Neema Swai");
  });

  it("marks an answer that was cut off", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "- 19 Nov: Stephen Budoya, TS" }, finish_reason: "length" }] }), { status: 200 }),
      ),
    );
    const res = await answerQuestion(buildMessages([], "interest?", NOW), NOW);
    expect(res.ok && res.answer).toContain("cut short");
  });

  it("drops a time stamp the model copied onto its own reply", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "[12 Nov 2026, 17:56] Hakuna." }, finish_reason: "stop" }] }), { status: 200 }),
      ),
    );
    const res = await answerQuestion(buildMessages([], "?", NOW), NOW);
    expect(res.ok && res.answer).toBe("Hakuna.");
  });
});

describe("buildMessages — the model knows when each earlier message was said", () => {
  it("stamps earlier turns with their Tanzania time and leaves the new question as now", () => {
    const msgs = buildMessages(
      [
        { role: "user", content: "Projected interest?", at: new Date("2026-11-10T06:00:00Z") },
        { role: "assistant", content: "TSh 2,571,750", at: new Date("2026-11-10T06:00:30Z") },
      ],
      "Has it changed since then?",
      NOW,
    );
    expect(msgs[0].content).toContain("Thursday 12 November 2026, 17:56");
    expect(msgs[0].content).toContain("may have changed since");
    expect(msgs[1]).toEqual({ role: "user", content: "[10 Nov 2026, 09:00] Projected interest?" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "[10 Nov 2026, 09:00] TSh 2,571,750" });
    expect(msgs[3]).toEqual({ role: "user", content: "Has it changed since then?" });
  });
});
