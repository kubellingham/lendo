"use client";

import { useState, useTransition } from "react";
import { MessageCircle, Copy, ExternalLink, Check } from "lucide-react";
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
  loan: ["loan"],
  payment: ["payment"],
  customer: ["customer"],
};

function waLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function SendMessage({
  context,
  triggerLabel = "Send WhatsApp",
  triggerVariant = "outline",
  triggerSize = "sm",
  defaultTemplateKey,
}: {
  context: Context;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm";
  defaultTemplateKey?: string;
}) {
  const available = MESSAGE_TEMPLATES.filter((t) =>
    CATEGORY_BY_KIND[context.kind].includes(t.category),
  );

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(defaultTemplateKey ?? available[0]?.key ?? "");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

          <DialogFooter>
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
