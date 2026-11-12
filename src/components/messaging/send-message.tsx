"use client";

import { useState, useTransition } from "react";
import {
  MessageCircle,
  Copy,
  ExternalLink,
  Check,
  FileDown,
  Sparkles,
  Undo2,
  Loader2,
} from "lucide-react";
import { rewriteMessage } from "@/lib/actions/rewrite-actions";
import type { Language, Tone } from "@/lib/ai/rewrite";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MESSAGE_TEMPLATES,
  type MessageCategory,
} from "@/lib/message-templates";
import {
  previewLoanMessage,
  previewPaymentMessage,
  previewCustomerMessage,
  type ReferralPick,
} from "@/lib/actions/message-actions";
import { cn } from "@/lib/utils";

type Context =
  | { kind: "loan"; loanId: string }
  | { kind: "payment"; paymentId: string }
  | { kind: "customer"; customerId: string };

const CATEGORY_BY_KIND: Record<Context["kind"], MessageCategory[]> = {
  loan: ["loan", "referral", "referral_upcoming"],
  payment: ["payment"],
  customer: ["customer", "referral_all", "referral_upcoming_all"],
};

function waLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// The matching branded PDF for a given situation, or null when the context has
// no document (ad-hoc customer messages).
// Referral messages that list several loans — these get the on/off list.
const PICKABLE = new Set(["referral_overdue_all", "referral_upcoming_all"]);

// "Due within" choices for upcoming payments (null = no limit).
const WINDOWS: { value: string; label: string }[] = [
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "all", label: "Any time" },
];
const DEFAULT_WINDOW = "7";

function inWindow(p: ReferralPick, w: string): boolean {
  return w === "all" || p.days <= Number(w);
}

function pdfHref(
  context: Context,
  key: string,
  loanIds?: string[],
): string | null {
  const loansQs = loanIds ? `loans=${encodeURIComponent(loanIds.join(","))}` : "";
  if (context.kind === "payment") {
    return `/api/receipts/payment/${context.paymentId}`;
  }
  if (context.kind === "loan") {
    if (key === "loan_disbursed") {
      return `/api/receipts/disbursement/${context.loanId}`;
    }
    // referral_overdue also routes here (notices/loan handles the type).
    return `/api/notices/loan/${context.loanId}?type=${encodeURIComponent(key)}`;
  }
  if (context.kind === "customer" && key === "referral_overdue_all") {
    return `/api/notices/referral/${context.customerId}${loansQs ? `?${loansQs}` : ""}`;
  }
  if (context.kind === "customer" && key === "referral_upcoming_all") {
    return `/api/notices/referral/${context.customerId}?type=upcoming${loansQs ? `&${loansQs}` : ""}`;
  }
  return null;
}

export function SendMessage({
  context,
  triggerLabel = "Send WhatsApp",
  triggerVariant = "outline",
  triggerSize = "sm",
  defaultTemplateKey,
  allowReferral = false,
  allowReferralUpcoming = false,
}: {
  context: Context;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm";
  defaultTemplateKey?: string;
  // Referral notices only make sense when the borrower is behind — the caller
  // passes true only when there's an overdue/defaulted loan to chase.
  allowReferral?: boolean;
  // Upcoming-payment heads-ups to the referral — true when a loan has a
  // payment still to come (not yet overdue).
  allowReferralUpcoming?: boolean;
}) {
  const available = MESSAGE_TEMPLATES.filter((t) => {
    if (!CATEGORY_BY_KIND[context.kind].includes(t.category)) return false;
    if ((t.category === "referral" || t.category === "referral_all") && !allowReferral)
      return false;
    if (
      (t.category === "referral_upcoming" ||
        t.category === "referral_upcoming_all") &&
      !allowReferralUpcoming
    )
      return false;
    return true;
  });

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(defaultTemplateKey ?? available[0]?.key ?? "");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Referral on/off list: every candidate loan + the ones switched on.
  const [picks, setPicks] = useState<ReferralPick[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW);
  // Lendo AI rewrite
  const [recipient, setRecipient] = useState("");
  // Where the loan stands, and a warning if the template doesn't fit.
  const [situation, setSituation] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ warning: string; suggestedKey?: string } | null>(null);
  const [lang, setLang] = useState<Language>("sw");
  const [tone, setTone] = useState<Tone>("auto");
  const [beforeRewrite, setBeforeRewrite] = useState<string | null>(null);
  const [rewriteNote, setRewriteNote] = useState<{
    tone: string;
    reason: string | null;
    problems: string[];
  } | null>(null);
  const [rewriting, startRewrite] = useTransition();

  function rewrite() {
    if (!message.trim()) return;
    setError(null);
    const original = beforeRewrite ?? message;
    startRewrite(async () => {
      const res = await rewriteMessage({
        message: original,
        language: lang,
        tone,
        context,
        recipientName: recipient || undefined,
        templateKey: key,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBeforeRewrite(original);
      setMessage(res.message);
      const problems = [
        ...(res.missing.length ? [`missing from the new text: ${res.missing.join(", ")}`] : []),
        ...(res.added.length ? [`new numbers that weren't in the original: ${res.added.join(", ")}`] : []),
        ...res.timing,
      ];
      setRewriteNote({ tone: res.toneUsed, reason: res.toneReason, problems });
    });
  }

  function undoRewrite() {
    if (beforeRewrite == null) return;
    setMessage(beforeRewrite);
    setBeforeRewrite(null);
    setRewriteNote(null);
  }

  const isPickable = PICKABLE.has(key) && !!picks && picks.length > 0;
  const isUpcoming = key === "referral_upcoming_all";
  const allOn = !!picks && selected.length === picks.length;
  const docHref =
    !key || (isPickable && selected.length === 0)
      ? null
      : pdfHref(context, key, isPickable && !allOn ? selected : undefined);

  // Re-render the message for just the chosen loans.
  function refresh(templateKey: string, ids: string[]) {
    if (context.kind !== "customer") return;
    setSelected(ids);
    setError(null);
    if (ids.length === 0) {
      setMessage("");
      return;
    }
    const customerId = context.customerId;
    startTransition(async () => {
      const res = await previewCustomerMessage(customerId, templateKey, {
        loanIds: ids.join(","),
      });
      if (!res.ok) {
        setError(res.error);
        setMessage("");
        return;
      }
      setMessage(res.message);
      setPhone(res.phoneE164);
      setBeforeRewrite(null);
      setRewriteNote(null);
    });
  }

  function loadPreview(templateKey: string) {
    setError(null);
    setKey(templateKey);
    setPicks(null);
    setSelected([]);
    startTransition(async () => {
      let res;
      if (context.kind === "loan") {
        res = await previewLoanMessage(context.loanId, templateKey);
      } else if (context.kind === "payment") {
        res = await previewPaymentMessage(context.paymentId, templateKey);
      } else {
        res = await previewCustomerMessage(context.customerId, templateKey);
      }
      if (!res.ok) {
        setError(res.error);
        setMessage("");
        setPhone("");
        setSituation(null);
        setMismatch(null);
        return;
      }
      setPhone(res.phoneE164);
      setRecipient(res.customerName);
      setSituation(res.situation ?? null);
      setMismatch(res.warning ? { warning: res.warning, suggestedKey: res.suggestedKey } : null);
      setBeforeRewrite(null);
      setRewriteNote(null);
      const list = res.referralLoans;
      if (!list || !PICKABLE.has(templateKey)) {
        setMessage(res.message);
        return;
      }
      // Overdue: everything starts on. Upcoming: only loans inside the
      // "Due within" limit start on.
      setPicks(list);
      const initial =
        templateKey === "referral_upcoming_all"
          ? list.filter((p) => inWindow(p, windowDays)).map((p) => p.loanId)
          : list.map((p) => p.loanId);
      if (initial.length === list.length) {
        setSelected(initial);
        setMessage(res.message);
      } else {
        refresh(templateKey, initial);
      }
    });
  }

  function onWindowChange(w: string) {
    setWindowDays(w);
    if (!picks) return;
    refresh(
      key,
      picks.filter((p) => inWindow(p, w)).map((p) => p.loanId),
    );
  }

  function toggleLoan(loanId: string) {
    if (!picks) return;
    const on = new Set(selected);
    if (on.has(loanId)) on.delete(loanId);
    else on.add(loanId);
    // Keep the original order of the list.
    refresh(
      key,
      picks.filter((p) => on.has(p.loanId)).map((p) => p.loanId),
    );
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && !message) loadPreview(key);
    if (!next) setCopied(false);
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard. Long-press the text to copy manually.");
    }
  }

  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        onClick={() => onOpenChange(true)}
      >
        <MessageCircle className="size-4" /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send WhatsApp message</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select
              value={key}
              onChange={(e) => loadPreview(e.target.value)}
              disabled={pending}
            >
              {available.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {available.find((t) => t.key === key)?.description}
            </p>
          </div>

          {isPickable && picks ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Loans to include</Label>
                {isUpcoming ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Due within
                    <Select
                      value={windowDays}
                      onChange={(e) => onWindowChange(e.target.value)}
                      disabled={pending}
                      className="h-8 w-auto py-0 text-xs"
                    >
                      {WINDOWS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </div>
              <ul className="divide-y rounded-lg border">
                {picks.map((p) => {
                  const on = selected.includes(p.loanId);
                  return (
                    <li
                      key={p.loanId}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-mono text-xs font-medium">
                          {p.loanRef}
                        </div>
                        <div
                          className={cn(
                            "text-xs",
                            on ? "text-muted-foreground" : "text-muted-foreground/60",
                          )}
                        >
                          Due {p.dueDate} · {p.when} · {p.amount}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`Include ${p.loanRef}`}
                        onClick={() => toggleLoan(p.loanId)}
                        disabled={pending}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                          on
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-slate-300 hover:bg-slate-400",
                          pending && "opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block size-5 rounded-full bg-white shadow transition-transform",
                            on ? "translate-x-5" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {selected.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No loans switched on
                  {isUpcoming && windowDays !== "all"
                    ? ` — nothing is due within ${windowDays} days. Widen “Due within” or switch a loan on.`
                    : " — switch at least one on."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {selected.length} of {picks.length} loan
                  {picks.length === 1 ? "" : "s"} in the message. Totals and the
                  PDF only count the ones switched on.
                </p>
              )}
            </div>
          ) : null}

          {situation ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">This loan now: </span>
              {situation}
            </p>
          ) : null}
          {mismatch ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>{mismatch.warning}</span>
              {mismatch.suggestedKey &&
              mismatch.suggestedKey !== key &&
              available.some((t) => t.key === mismatch.suggestedKey) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadPreview(mismatch.suggestedKey!)}
                  disabled={pending}
                >
                  Use “{available.find((t) => t.key === mismatch.suggestedKey)?.label}”
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Message (edit if needed)</Label>
              {phone ? (
                <span className="text-xs text-muted-foreground">To: {phone}</span>
              ) : null}
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={16}
              className="font-mono text-sm"
              placeholder={pending ? "Loading…" : ""}
            />
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-200 bg-violet-50/60 px-2 py-1.5">
              <Sparkles className="size-4 text-violet-700" />
              <Select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="h-8 w-auto py-0 text-xs"
                aria-label="Language"
              >
                <option value="sw">Kiswahili</option>
                <option value="en">English</option>
              </Select>
              <Select
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
                className="h-8 w-auto py-0 text-xs"
                aria-label="Tone"
              >
                <option value="auto">Tone: auto (from their record)</option>
                <option value="gentle">Gentle</option>
                <option value="normal">Normal</option>
                <option value="firm">Firm</option>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={rewrite}
                disabled={!message.trim() || rewriting || pending}
              >
                {rewriting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Rewrite with Lendo AI
              </Button>
              {beforeRewrite != null ? (
                <Button type="button" size="sm" variant="ghost" onClick={undoRewrite} disabled={rewriting}>
                  <Undo2 className="size-3.5" /> Undo
                </Button>
              ) : null}
            </div>
            {rewriteNote ? (
              rewriteNote.problems.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  <p className="font-medium">Check before sending — the rewrite changed some details:</p>
                  <ul className="mt-0.5 list-disc pl-4">
                    {rewriteNote.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="mt-0.5">Fix them in the text, rewrite again, or press Undo.</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Rewritten in a {rewriteNote.tone} tone
                  {rewriteNote.reason ? ` (auto: ${rewriteNote.reason})` : ""}. All amounts, dates, days and
                  account details match the original — read it once before sending.
                </p>
              )
            ) : null}
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {docHref ? (
            <p className="text-xs text-muted-foreground">
              Tip: WhatsApp can&apos;t auto-attach files. Download the PDF, then
              attach it in the chat (📎) alongside the message.
            </p>
          ) : null}

          <DialogFooter>
            {docHref ? (
              <Button asChild variant="outline">
                <a href={docHref} target="_blank" rel="noopener noreferrer">
                  <FileDown className="size-4" /> Download PDF
                </a>
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={copyToClipboard}
              disabled={!message || pending}
            >
              {copied ? (
                <>
                  <Check className="size-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-4" /> Copy text
                </>
              )}
            </Button>
            <Button asChild disabled={!message || !phone || pending}>
              <a
                href={message && phone ? waLink(phone, message) : "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4" /> Open in WhatsApp
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
