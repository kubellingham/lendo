"use client";

import { useState, useTransition } from "react";
import {
  MessageCircle,
  Copy,
  ExternalLink,
  Check,
  FileDown,
} from "lucide-react";
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
} from "@/lib/actions/message-actions";

type Context =
  | { kind: "loan"; loanId: string }
  | { kind: "payment"; paymentId: string }
  | { kind: "customer"; customerId: string };

const CATEGORY_BY_KIND: Record<Context["kind"], MessageCategory[]> = {
  loan: ["loan", "referral"],
  payment: ["payment"],
  customer: ["customer", "referral_all"],
};

function waLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// The matching branded PDF for a given situation, or null when the context has
// no document (ad-hoc customer messages).
function pdfHref(context: Context, key: string): string | null {
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
    return `/api/notices/referral/${context.customerId}`;
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
}: {
  context: Context;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm";
  defaultTemplateKey?: string;
  // Referral notices only make sense when the borrower is behind — the caller
  // passes true only when there's an overdue/defaulted loan to chase.
  allowReferral?: boolean;
}) {
  const available = MESSAGE_TEMPLATES.filter((t) => {
    if (!CATEGORY_BY_KIND[context.kind].includes(t.category)) return false;
    if ((t.category === "referral" || t.category === "referral_all") && !allowReferral)
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

  const docHref = key ? pdfHref(context, key) : null;

  function loadPreview(templateKey: string) {
    setError(null);
    setKey(templateKey);
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
        return;
      }
      setMessage(res.message);
      setPhone(res.phoneE164);
    });
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
