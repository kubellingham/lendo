"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Clock, History, Loader2, MessageSquarePlus, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  askLendo,
  deleteAskChat,
  getAskChat,
  getAskSnapshot,
  type ChatSummary,
  type StoredMessage,
} from "@/lib/actions/ask-actions";
import type { AskSnapshot } from "@/lib/ai/ask-core";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Who owes me the most right now?",
  "Ni nani amechelewa kulipa?",
  "Which payments are due this week?",
  "What is my projected interest this month?",
  "Aloyce alilipa lini mara ya mwisho?",
];

const LOOKUP_LABEL: Record<string, string> = {
  find_customers: "customers",
  customer_details: "customer history",
  loans_due_soon: "upcoming payments",
  late_loans: "late loans",
  business_totals: "business totals",
  interest_for_month: "interest for the month",
  top_debtors: "top debtors",
  recent_payments: "payments",
};

// Times are always shown in Tanzania time, the same on every device.
const TZ = "Africa/Dar_es_Salaam";
const fmtTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDay = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtShort = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => fmtTime.format(new Date(iso));
const dayOf = (iso: string | Date) => fmtDay.format(new Date(iso));

type Msg = StoredMessage & { pending?: boolean };
type Chat = { id: string; title: string; messages: StoredMessage[] };

/** Plain text with **bold** and line breaks. */
function Rich({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part.replace(/^#+\s*/gm, "")}</span>
        ),
      )}
    </div>
  );
}

// ---- The data an answer used, shown readably ------------------------------

const label = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function scalar(v: unknown): string {
  if (typeof v === "number") return Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v == null || v === "") return "—";
  return String(v);
}

const isScalar = (v: unknown) => v == null || typeof v !== "object";
// Shown first and without a label, in this order.
const PLAIN_KEYS = ["customer", "name", "loan", "date", "due"];

/** One row of a list: "Neema Swai · LND-B09R29 · round 1 · interest 120,000". */
function rowText(o: Record<string, unknown>): string {
  const entries = Object.entries(o).filter(([, v]) => isScalar(v));
  const first = PLAIN_KEYS.flatMap((k) => entries.filter(([key]) => key === k));
  const rest = entries.filter(([k]) => !PLAIN_KEYS.includes(k));
  return [...first.map(([, v]) => scalar(v)), ...rest.map(([k, v]) => `${label(k).toLowerCase()} ${scalar(v)}`)].join(
    " · ",
  );
}

function DataValue({ v, depth = 0 }: { v: unknown; depth?: number }) {
  if (isScalar(v)) return <span>{scalar(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-muted-foreground">none</span>;
    return (
      <ul className="list-disc space-y-0.5 pl-4">
        {v.slice(0, 25).map((item, i) => (
          <li key={i}>
            {isScalar(item) ? scalar(item) : depth < 2 && !Array.isArray(item) ? rowText(item as Record<string, unknown>) : "…"}
          </li>
        ))}
        {v.length > 25 ? <li className="text-muted-foreground">and {v.length - 25} more</li> : null}
      </ul>
    );
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "basis");
  return (
    <dl className="space-y-0.5">
      {entries.map(([k, val]) => (
        <div key={k} className={isScalar(val) ? "flex flex-wrap gap-x-1.5" : ""}>
          <dt className="text-muted-foreground">{label(k)}:</dt>
          <dd className={isScalar(val) ? "font-medium" : "mt-0.5"}>
            {depth < 3 ? <DataValue v={val} depth={depth + 1} /> : "…"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function argsText(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const parts = Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${label(k).toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function SnapshotView({ snap }: { snap: AskSnapshot }) {
  if (!snap.lookups.length) return <p className="text-xs text-muted-foreground">No lookups were needed for this answer.</p>;
  return (
    <div className="space-y-3 text-xs">
      {snap.lookups.map((l, i) => (
        <div key={i} className="rounded-md border bg-background p-2">
          <p className="mb-1 font-medium">
            {LOOKUP_LABEL[l.tool] ? label(LOOKUP_LABEL[l.tool]) : l.tool}
            <span className="font-normal text-muted-foreground">{argsText(l.args)}</span>
          </p>
          <DataValue v={l.result} />
        </div>
      ))}
    </div>
  );
}

// ---- The chat --------------------------------------------------------------

export function AskLendo({
  initialChats,
  initialChat,
}: {
  initialChats: ChatSummary[];
  initialChat: Chat | null;
}) {
  const [chats, setChats] = useState<ChatSummary[]>(initialChats);
  const [chatId, setChatId] = useState<string | null>(initialChat?.id ?? null);
  const [msgs, setMsgs] = useState<Msg[]>(initialChat?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [loadingChat, setLoadingChat] = useState(false);
  const [snaps, setSnaps] = useState<Record<string, AskSnapshot | "loading" | "none">>({});
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const today = dayOf(new Date());

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, pending]);

  function setUrl(id: string | null) {
    window.history.replaceState(null, "", id ? `/ai/ask?chat=${id}` : "/ai/ask");
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    const tempId = `temp-${++seq.current}`;
    setMsgs((m) => [
      ...m,
      { id: tempId, role: "user", content: q, isError: false, at: new Date().toISOString(), lookups: [], pending: true },
    ]);
    setDraft("");
    start(async () => {
      const res = await askLendo(chatId, q);
      setMsgs((m) => {
        const rest = m.filter((x) => x.id !== tempId);
        if (res.ok) return [...rest, res.question, res.answer];
        const asked = res.question ?? { ...m.find((x) => x.id === tempId)!, pending: false };
        return [
          ...rest,
          asked,
          { id: `err-${tempId}`, role: "assistant", content: res.error, isError: true, at: new Date().toISOString(), lookups: [] },
        ];
      });
      const id = res.chatId;
      if (id) {
        if (!chatId) {
          setChatId(id);
          setUrl(id);
        }
        const now = new Date().toISOString();
        setChats((list) => {
          const existing = list.find((c) => c.id === id);
          const updated: ChatSummary = existing
            ? { ...existing, updatedAt: now, messages: existing.messages + 2 }
            : { id, title: q.replace(/\s+/g, " ").slice(0, 80), updatedAt: now, messages: 2 };
          return [updated, ...list.filter((c) => c.id !== id)];
        });
      }
    });
  }

  async function openChat(id: string) {
    if (id === chatId || pending) return;
    setLoadingChat(true);
    const chat = await getAskChat(id);
    setLoadingChat(false);
    if (!chat) {
      setChats((l) => l.filter((c) => c.id !== id));
      return;
    }
    setChatId(chat.id);
    setMsgs(chat.messages);
    setUrl(chat.id);
  }

  function newChat() {
    if (pending) return;
    setChatId(null);
    setMsgs([]);
    setUrl(null);
  }

  async function removeChat(id: string) {
    if (!window.confirm("Delete this chat? This can't be undone.")) return;
    const res = await deleteAskChat(id);
    if (!res.ok) return;
    setChats((l) => l.filter((c) => c.id !== id));
    if (id === chatId) newChat();
  }

  async function toggleSnapshot(messageId: string) {
    if (snaps[messageId]) {
      setSnaps(({ [messageId]: _drop, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
      return;
    }
    setSnaps((s) => ({ ...s, [messageId]: "loading" }));
    const snap = await getAskSnapshot(messageId);
    setSnaps((s) => ({ ...s, [messageId]: snap ?? "none" }));
  }

  const lastAt = msgs.length ? msgs[msgs.length - 1].at : null;
  const olderChat = lastAt != null && dayOf(lastAt) !== today;

  return (
    <div className="grid max-w-6xl gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Past chats */}
      <Card className="h-fit">
        <CardContent className="space-y-2 p-3">
          <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={newChat}>
            <MessageSquarePlus className="size-4" /> New chat
          </Button>
          <p className="flex items-center gap-1.5 px-1 pt-1 text-xs font-medium text-muted-foreground">
            <History className="size-3.5" /> Past chats
          </p>
          {chats.length ? (
            <ul className="max-h-56 space-y-0.5 overflow-y-auto lg:max-h-[60vh]">
              {chats.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openChat(c.id)}
                    className={cn(
                      "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                      c.id === chatId && "bg-accent",
                    )}
                  >
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {fmtShort.format(new Date(c.updatedAt))} · {c.messages} message{c.messages === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeChat(c.id)}
                    aria-label={`Delete chat: ${c.title}`}
                    className="rounded p-1 text-muted-foreground opacity-60 hover:bg-red-50 hover:text-red-700 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">Your questions are saved here with their date and time.</p>
          )}
        </CardContent>
      </Card>

      {/* The chat */}
      <Card className="min-w-0">
        <CardContent className="space-y-4 pt-6">
          {olderChat ? (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Clock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This chat is from {fmtShort.format(new Date(lastAt!))}. Each answer shows the figures as they were at
                that time — payments since then may have changed them. New questions use today&apos;s records.
              </span>
            </div>
          ) : null}

          {loadingChat ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Opening chat…
            </div>
          ) : msgs.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Try one of these, or type your own question:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => send(e)}
                    className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {msgs.map((m) => {
                const snap = snaps[m.id];
                const earlierDay = dayOf(m.at) !== today;
                return (
                  <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : m.isError
                            ? "border border-red-200 bg-red-50 text-red-800"
                            : "bg-muted",
                      )}
                    >
                      {m.role === "assistant" && !m.isError ? (
                        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-violet-700">
                          <Sparkles className="size-3" /> Lendo AI
                        </div>
                      ) : null}
                      <Rich text={m.content} />
                      {m.role === "assistant" && !m.isError ? (
                        <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                          {m.lookups.length ? (
                            <div>
                              Looked at: {[...new Set(m.lookups.map((l) => LOOKUP_LABEL[l] ?? l))].join(", ")} ·{" "}
                              <button
                                type="button"
                                onClick={() => toggleSnapshot(m.id)}
                                className="font-medium text-violet-700 underline-offset-2 hover:underline"
                              >
                                {snap ? "Hide the data" : "Show the data it used"}
                              </button>
                            </div>
                          ) : null}
                          {snap === "loading" ? (
                            <div className="flex items-center gap-1">
                              <Loader2 className="size-3 animate-spin" /> Loading…
                            </div>
                          ) : snap === "none" ? (
                            <div>The data for this answer wasn&apos;t saved.</div>
                          ) : snap ? (
                            <div className="space-y-1.5 pt-1 text-foreground">
                              <p className="text-[11px] text-muted-foreground">
                                Lendo&apos;s records as they were on {when(snap.at)}:
                              </p>
                              <SnapshotView snap={snap} />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "mt-0.5 px-1 text-[10px]",
                        earlierDay && m.role === "assistant" ? "text-amber-700" : "text-muted-foreground",
                      )}
                    >
                      {m.pending ? "Sending…" : when(m.at)}
                      {earlierDay && m.role === "assistant" && !m.isError ? " · figures as of then" : ""}
                    </span>
                  </div>
                );
              })}
              {pending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Looking it up…
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex items-end gap-2 border-t pt-4"
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={2}
              placeholder="Ask about a customer, a loan, or the business…"
              className="resize-none"
            />
            <Button type="submit" disabled={!draft.trim() || pending} aria-label="Send">
              <SendHorizontal className="size-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Answers come from Lendo&apos;s records at the time shown. Lendo AI can make mistakes — check anything
            important on the customer or loan page. Your chats are private to your account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
