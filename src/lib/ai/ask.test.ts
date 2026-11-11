import { describe, it, expect, vi, afterEach } from "vitest";

// The Ask Lendo loop: model asks for a tool, gets the result, then answers.
vi.mock("@/lib/rbac", () => ({ getCurrentUser: async () => ({ id: "u1", role: "ADMIN" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/lendo-tools", () => ({
  LENDO_TOOLS: [{ type: "function", function: { name: "late_loans", description: "", parameters: {} } }],
  LendoData: class {},
  runLendoTool: vi.fn(async () => '[{"customer":"Neema Swai","days_late":10,"owes_now":920000}]'),
}));

import { askLendo } from "@/lib/actions/ask-actions";

describe("askLendo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs a lookup, then returns the answer", async () => {
    vi.stubEnv("AIMLAPI_API_KEY", "k");
    const replies = [
      { choices: [{ message: { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "late_loans", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
      { choices: [{ message: { content: "Neema Swai amechelewa siku 10." }, finish_reason: "stop" }] },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await askLendo([{ role: "user", content: "Ni nani amechelewa?" }]);
    expect(res).toEqual({ ok: true, answer: "Neema Swai amechelewa siku 10.", lookups: ["late_loans"] });

    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    const toolMsg = second.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("t1");
    expect(toolMsg.content).toContain("Neema Swai");
    expect(second.tools).toHaveLength(1);
  });

  it("needs a question", async () => {
    const res = await askLendo([{ role: "user", content: "  " }]);
    expect(res.ok).toBe(false);
  });
});
