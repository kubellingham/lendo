"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  findCustomerHref,
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

export function ReceiptScanner() {
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<Ok | null>(null);
  const [kind, setKind] = useState<Kind>("UNKNOWN");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, start] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const takeFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a picture of the receipt (a screenshot or photo).");
      return;
    }
    setError(null);
    setResult(null);
    setPreparing(true);
    try {
      setImage(await compress(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }, []);

  // Paste a screenshot straight from the clipboard (Ctrl/Cmd+V).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) takeFile(item.getAsFile());
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeFile]);

  function read() {
    if (!image) return;
    setError(null);
    start(async () => {
      const res = await scanReceipt(image);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
      setKind(res.reading.kind);
    });
  }

  function reset() {
    setImage(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* ---- Left: the receipt */}
      <Card>
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt="Receipt to read"
              className="max-h-[520px] w-full rounded-md border object-contain"
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
                takeFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex h-64 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors",
                dragOver ? "border-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              {preparing ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <ImageUp className="size-6" />
              )}
              <span className="font-medium text-foreground">Choose a receipt picture</span>
              <span>or drag it here, or paste a screenshot (Ctrl/⌘ + V)</span>
            </button>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={read} disabled={!image || pending || preparing}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Read receipt
                </>
              )}
            </Button>
            {image ? (
              <Button variant="outline" onClick={reset} disabled={pending}>
                <RotateCcw className="size-4" /> Another receipt
              </Button>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            The picture is only used to read the details. It isn&apos;t stored.
          </p>
        </CardContent>
      </Card>

      {/* ---- Right: what Lendo AI read */}
      <div className="space-y-4">
        {!result ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {pending
                ? "Lendo AI is reading the receipt…"
                : "Upload a receipt and tap “Read receipt”. Lendo AI fills in the details — you check and approve them before anything is saved."}
            </CardContent>
          </Card>
        ) : (
          <ResultView result={result} kind={kind} setKind={setKind} />
        )}
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
    [kind === "PAYMENT_RECEIVED" ? "Paid by" : "Sent to", r.counterpartyName],
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

function PaymentNext({ result }: { result: Ok }) {
  const r = result.reading;
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
                  <ul className="space-y-2">
                    {m.openLoans.map((l) => (
                      <li
                        key={l.loanId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"
                      >
                        <div className="text-sm">
                          <span className="font-mono text-xs font-medium">{l.ref}</span> · {tsh(l.principal)}{" "}
                          given {l.givenOn}
                          <div className="text-xs text-muted-foreground">
                            Interest due {tsh(l.interestOnly)} · to clear {tsh(l.settlement)}
                            {l.hint ? (
                              <span className="ml-1 font-medium text-emerald-700">· {l.hint}</span>
                            ) : null}
                          </div>
                        </div>
                        <Button asChild size="sm">
                          <Link href={recordPaymentHref(prefill(r), l.loanId)}>
                            Review &amp; record <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {m.name} has no open loans in Lendo.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No customer in Lendo matches &ldquo;{r.counterpartyName ?? "this name"}&rdquo;.
          </p>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={findCustomerHref(r.counterpartyName)}>
            Find the customer myself
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
