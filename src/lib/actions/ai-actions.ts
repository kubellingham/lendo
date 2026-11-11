"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, ForbiddenError, WRITE_ROLES } from "@/lib/rbac";
import { getPaymentDetails } from "@/lib/settings";
import { AiError } from "@/lib/ai/client";
import { readReceipt, type ReceiptReading } from "@/lib/ai/receipt-ai";
import {
  loadCustomers,
  loanRef,
  suggestCustomers,
  type CustomerSuggestion,
} from "@/lib/ai/suggest";

export type { CustomerSuggestion, OpenLoanSuggestion } from "@/lib/ai/suggest";

const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB image once base64-encoded
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export type ScanResult =
  | {
      ok: true;
      reading: ReceiptReading;
      matches: CustomerSuggestion[];
      /** Something with this bank reference is already in Lendo. */
      duplicate: { what: string; href: string } | null;
    }
  | { ok: false; error: string };

export async function scanReceipt(imageDataUrl: string): Promise<ScanResult> {
  let user;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  if (typeof imageDataUrl !== "string" || !IMAGE_DATA_URL.test(imageDataUrl)) {
    return { ok: false, error: "Please upload a picture (JPG, PNG or WebP) of the receipt." };
  }
  if (imageDataUrl.length > MAX_IMAGE_CHARS) {
    return { ok: false, error: "That image is too large. Try a smaller screenshot." };
  }

  let reading: ReceiptReading;
  try {
    reading = await readReceipt(imageDataUrl, await getPaymentDetails());
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[scanReceipt]", err);
    return { ok: false, error: "Lendo AI hit an unexpected problem. Please try again." };
  }

  // ---- Who is this? (top matches + their open loans)
  const [matches] = await suggestCustomers(await loadCustomers(), [
    { name: reading.counterpartyName, account: reading.counterpartyAccount, amount: reading.amount },
  ]);

  // ---- Already recorded?
  let duplicate: { what: string; href: string } | null = null;
  if (reading.reference) {
    const [payment, loan] = await Promise.all([
      db.payment.findFirst({
        where: { reference: { equals: reading.reference, mode: "insensitive" } },
        select: { loanId: true, amount: true, loan: { select: { customer: { select: { fullName: true } } } } },
      }),
      db.loan.findFirst({
        where: { reference: { equals: reading.reference, mode: "insensitive" } },
        select: { id: true, customer: { select: { fullName: true } } },
      }),
    ]);
    if (payment) {
      duplicate = {
        what: `a payment of TSh ${Number(payment.amount).toLocaleString("en-US")} from ${payment.loan.customer.fullName}`,
        href: `/loans/${payment.loanId}`,
      };
    } else if (loan) {
      duplicate = {
        what: `loan ${loanRef(loan.id)} to ${loan.customer.fullName}`,
        href: `/loans/${loan.id}`,
      };
    }
  }

  // The image itself is not stored — only what was read.
  await audit({
    actorId: user.id,
    action: "ai.receipt_read",
    entity: "Receipt",
    entityId: reading.reference ?? "no-reference",
    after: {
      reading: { ...reading },
      topMatch: matches[0] ? { customerId: matches[0].id, score: matches[0].score } : null,
      duplicate: !!duplicate,
    },
  });

  return { ok: true, reading, matches, duplicate };
}
