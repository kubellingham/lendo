// ---------------------------------------------------------------------------
// Lendo AI — shared client for AIML API (OpenAI-compatible chat completions)
// serving Claude Haiku 5.5. Every Lendo AI feature goes through aiChat().
//
// Env vars:
//   AIMLAPI_API_KEY   required — from the AIML API dashboard
//   AIMLAPI_MODEL     optional — defaults to anthropic/claude-haiku-5.5
//   AIMLAPI_BASE_URL  optional — defaults to https://api.aimlapi.com/v1
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://api.aimlapi.com/v1";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

export class AiError extends Error {}

export function aiConfigured(): boolean {
  return !!process.env.AIMLAPI_API_KEY?.trim();
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
};

export async function aiChat(opts: {
  messages: ChatMessage[];
  maxTokens?: number;
  effort?: "none" | "low" | "medium" | "high";
  tools?: ToolDef[];
  timeoutMs?: number;
}): Promise<ChatResult> {
  const key = process.env.AIMLAPI_API_KEY?.trim();
  if (!key) throw new AiError("Lendo AI isn't switched on yet (no AIML API key).");

  const base = (process.env.AIMLAPI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AIMLAPI_MODEL?.trim() || DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 2000,
        reasoning_effort: opts.effort ?? "low",
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      }),
    });
  } catch (err) {
    throw new AiError(
      (err as Error).name === "AbortError"
        ? "Lendo AI took too long to answer. Please try again."
        : "Couldn't reach Lendo AI. Check the internet connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiError("The AIML API key was rejected. Check AIMLAPI_API_KEY in Vercel.");
  }
  if (res.status === 402) {
    throw new AiError("Your AIML API account is out of credits. Top up to keep using Lendo AI.");
  }
  if (res.status === 429) {
    throw new AiError("Lendo AI is busy right now. Wait a moment and try again.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[aiChat] AIML API error", res.status, body.slice(0, 500));
    throw new AiError(`Lendo AI returned an error (${res.status}). Please try again.`);
  }

  const json = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: ToolCall[] | null };
      finish_reason?: string | null;
    }[];
  };
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? null,
  };
}

/** The first JSON object or array in a model reply (tolerates code fences and prose). */
export function extractJson(text: string): unknown | null {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
