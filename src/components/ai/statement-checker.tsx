"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  findCustomerHref,
  issueLoanHref,
  newCustomerHref,
  recordPaymentHref,
  type Prefill,
} from "@/lib/ai/links";
import type { StatementCheckResult } from "@/app/api/ai/statement/route";

type Item = StatementCheckResult["items"][number];

function tsh(n: number) {
  return `TSh ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function prefill(i: Item): Prefill {
  return {
    amount: i.txn.amount,
    date: i.txn.date,
    reference: i.txn.ref,
    method: "BANK",
    name: i.txn.name,
    account: i.txn.phone,
  };
}

const SECTIONS: {
  status: Item["status"];
  title: string;
  hint: string;
  tone: string;
}[] = [
  {
    status: "missing_payment",
    title: "Money in — not recorded as a payment",
    hint: "Someone paid into the account but Lendo has no matching payment.",
    tone: "border-red-200 bg-red-50 text-red-800",
  },
  {
    status: "missing_loan",
    title: "Money out — no matching loan in Lendo",
    hint: "Money was sent to a person but Lendo has no loan for that amount and date.",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
  },
  {
    status: "other",
    title: "Other money in / out",
    hint: "Doesn't look like lending (or the direction didn't fit). Check if any of these are loans or payments.",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
  },
  {
    status: "recorded",
    title: "Already in Lendo",
    hint: "Matched to a payment or loan.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  {
    status: "ignored",
    title: "Bank fees & own transfers (ignored)",
    hint: "Charges, VAT and transfers between the business's own accounts.",
    tone: "border-slate-200 bg-slate-50 text-slate-500",
  },
];

export function StatementChecker({ canWrite }: { canWrite: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatementCheckResult | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ missing_payment: true, missing_loan: true });
  const inputRef = useRef<HTMLInputElement>(null);

  async function check() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/ai/statement", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setError(json?.error ?? `Something went wrong (${res.status}). Please try again.`);
        return;
      }
      setResult(json as StatementCheckResult);
    } catch {
      setError("Couldn't reach Lendo. Check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const count = (s: Item["status"]) => result?.items.filter((i) => i.status === s).length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileText className="size-4" /> {file ? "Choose another PDF" : "Choose statement PDF"}
          </Button>
          {file ? <span className="text-sm text-muted-foreground">{file.name}</span> : null}
          <Button onClick={check} disabled={!file || busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Reading… (about a minute)
              </>
            ) : (
              "Check statement"
            )}
          </Button>
          {error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="w-full text-xs text-muted-foreground">
            Works with statement PDFs downloaded from the bank (not photos). The PDF isn&apos;t stored.
          </p>
        </CardContent>
      </Card>

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Summary label="Transactions" value={result.items.length} />
            <Summary label="Already in Lendo" value={count("recorded")} tone="text-emerald-700" />
            <Summary label="Payments missing" value={count("missing_payment")} tone={count("missing_payment") ? "text-red-700" : undefined} />
            <Summary label="Loans missing" value={count("missing_loan")} tone={count("missing_loan") ? "text-amber-700" : undefined} />
            <Summary label="Other" value={count("other")} />
            <Summary label="In Lendo, not on statement" value={result.lendoOnly.length} tone={result.lendoOnly.length ? "text-amber-700" : undefined} />
          </div>
          {result.period ? (
            <p className="text-xs text-muted-foreground">
              Statement period {result.period.from} to {result.period.to}. Directions are checked against the
              statement&apos;s running balance; lines marked &ldquo;unchecked&rdquo; couldn&apos;t be.
            </p>
          ) : null}

          {SECTIONS.map((sec) => {
            const rows = result.items.filter((i) => i.status === sec.status);
            if (!rows.length) return null;
            const isOpen = !!open[sec.status];
            return (
              <Card key={sec.status}>
                <CardHeader>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setOpen((o) => ({ ...o, [sec.status]: !isOpen }))}
                  >
                    <div>
                      <CardTitle>
                        {sec.title} <span className="text-muted-foreground">({rows.length})</span>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">{sec.hint}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{isOpen ? "Hide" : "Show"}</span>
                  </button>
                </CardHeader>
                {isOpen ? (
                  <CardContent>
                    <ul className="divide-y rounded-md border">
                      {rows.map((i) => (
                        <Row key={`${i.txn.sn}-${i.txn.ref}`} item={i} canWrite={canWrite} />
                      ))}
                    </ul>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}

          {result.lendoOnly.length ? (
            <Card>
              <CardHeader>
                <CardTitle>In Lendo as &ldquo;Bank&rdquo; but not on this statement ({result.lendoOnly.length})</CardTitle>
                <p className="text-xs text-muted-foreground">
                  These payments are recorded as bank payments in the statement period, but no matching line was
                  found. Check the method or amount.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-md border">
                  {result.lendoOnly.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <span>
                        {p.paidOn} · {tsh(p.amount)} · {p.customerName} · {p.loanRef}
                      </span>
                      <Link href={`/loans/${p.loanId}`} className="text-xs font-medium underline">
                        Open loan
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("stat-value mt-1 text-2xl font-semibold", tone)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Row({ item, canWrite }: { item: Item; canWrite: boolean }) {
  const t = item.txn;
  const pf = prefill(item);
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className={cn("font-semibold", t.dir === "in" ? "text-emerald-700" : "text-red-700")}>
            {t.dir === "in" ? "+" : "−"}
            {tsh(t.amount)}
          </span>{" "}
          · {t.date} · {t.name ?? "Unknown"}
          {t.note ? <span className="text-muted-foreground"> · &ldquo;{t.note}&rdquo;</span> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          #{t.sn}
          {t.ref ? ` · ref ${t.ref}` : ""}
          {t.verified ? "" : " · unchecked"}
        </div>
      </div>

      {item.matched ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="size-3.5" />
          <Link href={item.matched.href} className="underline">
            {item.matched.label}
          </Link>
          <span className="text-muted-foreground">(matched by {item.matched.by})</span>
        </div>
      ) : null}

      {canWrite && item.status !== "recorded" && item.status !== "ignored" ? (
        <div className="space-y-1.5">
          {item.suggestions.map((s) => (
            <div key={s.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
              <div className="mb-1 font-medium">
                {s.name} <span className="font-normal text-muted-foreground">· {Math.round(s.score * 100)}% match</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.dir === "in"
                  ? s.openLoans.map((l) => (
                      <Button key={l.loanId} asChild size="sm" variant="secondary">
                        <Link href={recordPaymentHref(pf, l.loanId)}>
                          Record on {l.ref}
                          {l.hint ? ` · ${l.hint}` : ""} <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    ))
                  : (
                      <Button asChild size="sm" variant="secondary">
                        <Link href={issueLoanHref(pf, s.id)}>
                          Issue loan to {s.name} <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    )}
                {t.dir === "in" && !s.openLoans.length ? (
                  <span className="text-muted-foreground">No open loans.</span>
                ) : null}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {t.dir === "out" ? (
              <Button asChild size="sm" variant="outline">
                <Link href={newCustomerHref(pf)}>
                  <UserPlus className="size-3.5" /> New customer{t.name ? `: ${t.name}` : ""}
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={findCustomerHref(t.name)}>Find the customer myself</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
