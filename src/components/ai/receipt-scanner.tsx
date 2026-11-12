"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ImageUp,
  Loader2,
  RotateCcw,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scanReceipt, type ScanResult } from "@/lib/actions/ai-actions";
import type { ReceiptReading } from "@/lib/ai/receipt-ai";
import { cn } from "@/lib/utils";
import {
  issueLoanHref,
  newCustomerHref,
  recordPaymentHref,
  type Prefill,
} from "@/lib/ai/links";

type Kind = ReceiptReading["kind"];
type Ok = Extract<ScanResult, { ok: true }>;

const KIND_LABEL: Record<Kind, string> = {
  LOAN_GIVEN: "Loan given out",
  PAYMENT_RECEIVED: "Payment received",
  UNKNOWN: "Not sure",
};

const MAX_SIDE = 1600;

/** Shrink big photos/screenshots before upload; returns a JPEG data URL. */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't open that image."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that image.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function tsh(n: number | null | undefined) {
  return n == null ? "—" : `TSh ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** What the shared link helpers need, from a receipt reading. */
function prefill(r: ReceiptReading): Prefill {
  return {
    amount: r.amount,
    date: r.date,
    reference: r.reference,
    method: r.method,
    name: r.counterpartyName,
    account: r.counterpartyAccount,
  };
}

type Item = {
  id: string;
  name: string;
  image: string;
  status: "ready" | "reading" | "done" | "error";
  result?: Ok;
  error?: string;
  kind: Kind;
};

const MAX_ITEMS = 20;
const PARALLEL = 2;

export function ReceiptScanner() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const takeFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setError("Please choose pictures of receipts (screenshots or photos).");
      return;
    }
    setError(null);
    setPreparing(true);
    try {
      const added: Item[] = [];
      for (const f of images) {
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: f.name || "Pasted screenshot",
          image: await compress(f),
          status: "ready",
          kind: "UNKNOWN",
        });
      }
      setItems((list) => {
        const next = [...list, ...added].slice(0, MAX_ITEMS);
        if (list.length + added.length > MAX_ITEMS) {
          setError(`Up to ${MAX_ITEMS} receipts at a time — the rest were skipped.`);
        }
        return next;
      });
      setSelected((cur) => cur ?? added[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }, []);

  // Paste screenshots straight from the clipboard (Ctrl/Cmd+V).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) takeFiles(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeFiles]);

  async function readOne(it: Item) {
    update(it.id, { status: "reading", error: undefined });
    try {
      const res = await scanReceipt(it.image);
      if (res.ok) update(it.id, { status: "done", result: res, kind: res.reading.kind });
      else update(it.id, { status: "error", error: res.error });
    } catch {
      update(it.id, { status: "error", error: "Couldn't reach Lendo. Try again." });
    }
  }

  async function readAll() {
    const queue = items.filter((i) => i.status === "ready" || i.status === "error");
    if (!queue.length) return;
    setReading(true);
    setError(null);
    async function worker() {
      for (let it = queue.shift(); it; it = queue.shift()) await readOne(it);
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setReading(false);
  }

  function remove(id: string) {
    setItems((list) => {
      const next = list.filter((i) => i.id !== id);
      if (selected === id) setSelected(next[0]?.id ?? null);
      return next;
    });
  }

  function reset() {
    setItems([]);
    setSelected(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const current = items.find((i) => i.id === selected) ?? null;
  const toRead = items.filter((i) => i.status === "ready" || i.status === "error").length;
  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* ---- Left: the receipts */}
      <Card>
        <CardHeader>
          <CardTitle>
            Receipts{items.length ? ` (${done}/${items.length} read)` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              takeFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.image}
              alt="Receipt to read"
              className="max-h-[440px] w-full rounded-md border object-contain"
            />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                takeFiles([...(e.dataTransfer.files ?? [])]);
              }}
              className={cn(
                "flex h-64 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors",
                dragOver ? "border-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              {preparing ? <Loader2 className="size-6 animate-spin" /> : <ImageUp className="size-6" />}
              <span className="font-medium text-foreground">Choose receipt pictures</span>
              <span>one or many — or drag them here, or paste a screenshot (Ctrl/⌘ + V)</span>
            </button>
          )}

          {items.length > 0 ? (
            <ul className="grid grid-cols-5 gap-2">
              {items.map((it, i) => (
                <li key={it.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelected(it.id)}
                    className={cn(
                      "block aspect-[3/4] w-full overflow-hidden rounded border-2",
                      it.id === selected ? "border-primary" : "border-transparent",
                    )}
                    title={it.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.image} alt={`Receipt ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                  <span
                    className={cn(
                      "absolute bottom-1 left-1 rounded px-1 text-[10px] font-medium",
                      it.status === "done"
                        ? "bg-emerald-600 text-white"
                        : it.status === "error"
                          ? "bg-red-600 text-white"
                          : it.status === "reading"
                            ? "bg-violet-600 text-white"
                            : "bg-white/90 text-slate-700",
                    )}
                  >
                    {it.status === "done" ? "✓" : it.status === "error" ? "!" : it.status === "reading" ? "…" : i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    disabled={it.status === "reading"}
                    className="absolute right-0.5 top-0.5 rounded bg-white/90 px-1 text-[10px] leading-4 text-slate-600 hover:bg-white"
                    aria-label={`Remove receipt ${i + 1}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={readAll} disabled={!toRead || reading || preparing}>
              {reading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  {items.length > 1 ? `Read ${toRead} receipt${toRead === 1 ? "" : "s"}` : "Read receipt"}
                </>
              )}
            </Button>
            {items.length ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={reading || items.length >= MAX_ITEMS}
                >
                  <ImageUp className="size-4" /> Add more
                </Button>
                <Button variant="ghost" onClick={reset} disabled={reading}>
                  <RotateCcw className="size-4" /> Clear
                </Button>
              </>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Pictures are only used to read the details. They aren&apos;t stored.
          </p>
        </CardContent>
      </Card>

      {/* ---- Right: what Lendo AI read for the selected receipt */}
      <div className="space-y-4">
        {current?.result ? (
          <ResultView
            key={current.id}
            result={current.result}
            kind={current.kind}
            setKind={(k) => update(current.id, { kind: k })}
          />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {current?.status === "reading"
                ? "Lendo AI is reading this receipt…"
                : current?.status === "error"
                  ? current.error
                  : items.length
                    ? "Tap “Read” and Lendo AI fills in the details for each receipt — then review them one by one."
                    : "Upload receipts and tap “Read”. Lendo AI fills in the details — you check and approve them before anything is saved."}
            </CardContent>
          </Card>
        )}
        {current?.result && items.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Tip: forms open in the same tab — use your browser&apos;s back button to return here for the next
            receipt, or open them in a new tab.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ResultView({
  result,
  kind,
  setKind,
}: {
  result: Ok;
  kind: Kind;
  setKind: (k: Kind) => void;
}) {
  const r = result.reading;
  const failed = r.transactionStatus && /fail|declin|revers|pending|cancel/i.test(r.transactionStatus);

  const rows: [string, string | null][] = [
    ["Amount", r.amount != null ? `${tsh(r.amount)}${r.currency && r.currency !== "TZS" ? ` (${r.currency})` : ""}` : null],
    ["Date", r.date ? `${r.date}${r.time ? `, ${r.time}` : ""}` : null],
    [
      kind === "PAYMENT_RECEIVED" ? "Paid by" : "Sent to",
      r.counterpartyName ?? (r.counterpartyAccount ? "No name on the receipt — see account" : null),
    ],
    ["Their account / phone", r.counterpartyAccount],
    ["Bank reference", r.reference],
    ["Description", r.description],
    ["Bank / provider", r.provider],
    ["Transfer status", r.transactionStatus],
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> What Lendo AI read
          </CardTitle>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              r.confidence === "high"
                ? "bg-emerald-50 text-emerald-700"
                : r.confidence === "medium"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700",
            )}
          >
            {r.confidence === "high" ? "Confident" : r.confidence === "medium" ? "Fairly sure" : "Unsure — check carefully"}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">This receipt is a…</p>
            <div className="inline-flex rounded-md border p-0.5">
              {(["LOAN_GIVEN", "PAYMENT_RECEIVED"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm transition-colors",
                    kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {r.kind === "UNKNOWN" ? (
              <p className="mt-1.5 text-xs text-amber-700">
                Lendo AI couldn&apos;t tell which way the money went — pick one.
              </p>
            ) : kind !== r.kind ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                You changed this from &ldquo;{KIND_LABEL[r.kind]}&rdquo;.
              </p>
            ) : null}
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={cn("break-words", !value && "text-muted-foreground")}>
                  {value ?? "Couldn't read"}
                </dd>
              </div>
            ))}
          </dl>

          {r.notes ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Lendo AI&apos;s notes: </span>
              {r.notes}
            </p>
          ) : null}

          {failed ? (
            <Warning>
              The receipt says the transfer status is &ldquo;{r.transactionStatus}&rdquo;. Make sure the
              money actually went through before recording it.
            </Warning>
          ) : null}
          {result.duplicate ? (
            <Warning>
              This bank reference is already in Lendo, on {result.duplicate.what}.{" "}
              <Link href={result.duplicate.href} className="font-medium underline">
                Open it
              </Link>{" "}
              before recording it again.
            </Warning>
          ) : null}
        </CardContent>
      </Card>

      {kind === "LOAN_GIVEN" ? <LoanNext result={result} /> : null}
      {kind === "PAYMENT_RECEIVED" ? <PaymentNext result={result} /> : null}

      <p className="text-xs text-muted-foreground">
        Lendo AI only suggests. The next screen opens the normal form already filled in —
        nothing is saved until you check it and press save.
      </p>
    </>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function MatchHeader({ m }: { m: Ok["matches"][number] }) {
  return (
    <div className="min-w-0">
      <div className="font-medium">{m.name}</div>
      <div className="text-xs text-muted-foreground">
        {m.phone} · {m.reasons.join(" · ") || "Possible match"} · {Math.round(m.score * 100)}% match
      </div>
    </div>
  );
}

function LoanNext({ result }: { result: Ok }) {
  const r = result.reading;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who received the loan?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.matches.length ? (
          <ul className="divide-y rounded-md border">
            {result.matches.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <MatchHeader m={m} />
                <Button asChild size="sm">
                  <Link href={issueLoanHref(prefill(r), m.id)}>
                    Review &amp; issue loan <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No customer in Lendo matches &ldquo;{r.counterpartyName ?? "this name"}&rdquo;.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={result.matches.length ? "outline" : "default"} size="sm">
            <Link href={newCustomerHref(prefill(r))}>
              <UserPlus className="size-4" /> New customer
              {r.counterpartyName ? `: ${r.counterpartyName}` : ""}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={issueLoanHref(prefill(r))}>Pick the customer myself</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type LoanRowData = Ok["matches"][number]["openLoans"][number];

/** One open loan with what it expects now, and a button to record the payment on it. */
function LoanRow({ l, r, who }: { l: LoanRowData; r: ReceiptReading; who?: string }) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2",
        l.bestFit ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-muted/50",
      )}
    >
      <div className="min-w-0 text-sm">
        {who ? <span className="font-medium">{who} · </span> : null}
        <span className="font-mono text-xs font-medium">{l.ref}</span> · {tsh(l.principal)} given {l.givenOn}
        {l.bestFit ? (
          <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Best fit
          </span>
        ) : null}
        {l.dueText ? <div className="text-xs text-muted-foreground">{l.dueText}</div> : null}
        <div className="text-xs text-muted-foreground">
          {l.isFinalRound ? (
            <>Full balance due {tsh(l.settlement)}</>
          ) : (
            <>
              Minimum {tsh(l.minimumDue)} · to clear {tsh(l.settlement)}
            </>
          )}
          {l.hint ? (
            <span className={cn("ml-1 font-medium", l.exactAmount ? "text-emerald-700" : "text-amber-700")}>
              · {l.hint}
            </span>
          ) : null}
        </div>
        {l.bestFit ? <div className="text-xs text-emerald-800">Suggested because {l.bestFit}.</div> : null}
      </div>
      <Button asChild size="sm" variant={l.bestFit ? "default" : "outline"}>
        <Link href={recordPaymentHref(prefill(r), l.loanId)}>
          Review &amp; record <ArrowRight className="size-4" />
        </Link>
      </Button>
    </li>
  );
}

/** Every open loan, searchable — for when the receipt doesn't say who paid. */
function LoanPicker({ result, open }: { result: Ok; open: boolean }) {
  const r = result.reading;
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = result.choices.filter((c) => {
    const hay = `${c.customerName} ${c.phone} ${c.ref}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const exact = result.choices.filter((c) => c.exactAmount).length;
  return (
    <details open={open} className="rounded-md border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        Pick the loan myself{" "}
        <span className="font-normal text-muted-foreground">
          ({result.choices.length} open loan{result.choices.length === 1 ? "" : "s"}
          {exact && r.amount ? `, ${exact} expecting exactly ${tsh(r.amount)}` : ""})
        </span>
      </summary>
      <div className="space-y-2 border-t p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone or loan ref…"
          aria-label="Search open loans"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        />
        {list.length ? (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {list.slice(0, 60).map((c) => (
              <LoanRow key={c.loanId} l={c} r={r} who={c.customerName} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No open loan matches that search.</p>
        )}
        {list.length > 60 ? (
          <p className="text-xs text-muted-foreground">Showing 60 of {list.length} — search to narrow down.</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Loans expecting exactly this amount are listed first, then by due date. The amount, date, reference
          and the payer&apos;s account are carried over to the payment form.
        </p>
      </div>
    </details>
  );
}

function PaymentNext({ result }: { result: Ok }) {
  const r = result.reading;
  const anyLoans = result.matches.some((m) => m.openLoans.length);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which loan is this payment for?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.matches.length ? (
          <ul className="divide-y rounded-md border">
            {result.matches.map((m) => (
              <li key={m.id} className="space-y-2 p-3">
                <MatchHeader m={m} />
                {m.openLoans.length ? (
                  <>
                    {m.openLoans.length > 1 ? (
                      <p className="text-xs text-muted-foreground">
                        {m.name} has {m.openLoans.length} open loans — check the suggested one, or pick another.
                      </p>
                    ) : null}
                    <ul className="space-y-2">
                      {m.openLoans.map((l) => (
                        <LoanRow key={l.loanId} l={l} r={r} />
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{m.name} has no open loans in Lendo.</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {r.counterpartyName ? (
              <>No customer in Lendo matches &ldquo;{r.counterpartyName}&rdquo;.</>
            ) : (
              <>
                The receipt doesn&apos;t say who paid
                {r.counterpartyAccount ? (
                  <>
                    {" "}— only the account <span className="font-mono">{r.counterpartyAccount}</span>, which Lendo
                    hasn&apos;t seen before
                  </>
                ) : null}
                . Pick the loan below; Lendo will remember the account for next time.
              </>
            )}
          </p>
        )}
        <LoanPicker result={result} open={!anyLoans} />
      </CardContent>
    </Card>
  );
}
