"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { askLendo, type AskTurn } from "@/lib/actions/ask-actions";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Who owes me the most right now?",
  "Ni nani amechelewa kulipa?",
  "Which payments are due this week?",
  "How much profit did we make last month?",
  "Aloyce alilipa lini mara ya mwisho?",
];

const LOOKUP_LABEL: Record<string, string> = {
  find_customers: "customers",
  customer_details: "customer history",
  loans_due_soon: "upcoming payments",
  late_loans: "late loans",
  business_totals: "business totals",
  top_debtors: "top debtors",
  recent_payments: "payments",
};

type Msg = AskTurn & { lookups?: string[]; error?: boolean };

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

export function AskLendo() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, pending]);

  function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setDraft("");
    start(async () => {
      const history: AskTurn[] = next
        .filter((m) => !m.error)
        .map(({ role, content }) => ({ role, content }));
      const res = await askLendo(history);
      setMsgs((m) => [
        ...m,
        res.ok
          ? { role: "assistant", content: res.answer, lookups: res.lookups }
          : { role: "assistant", content: res.error, error: true },
      ]);
    });
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 pt-6">
        {msgs.length === 0 ? (
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
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.error
                        ? "border border-red-200 bg-red-50 text-red-800"
                        : "bg-muted",
                  )}
                >
                  {m.role === "assistant" && !m.error ? (
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-violet-700">
                      <Sparkles className="size-3" /> Lendo AI
                    </div>
                  ) : null}
                  <Rich text={m.content} />
                  {m.lookups?.length ? (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      Looked at: {[...new Set(m.lookups.map((l) => LOOKUP_LABEL[l] ?? l))].join(", ")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
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
          Answers come from Lendo&apos;s records. Lendo AI can make mistakes — check anything important on the
          customer or loan page.
        </p>
      </CardContent>
    </Card>
  );
}
