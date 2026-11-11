import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/rbac";
import { getPaymentDetails } from "@/lib/settings";
import { AiError } from "@/lib/ai/client";
import { pdfPages, readStatement, statementPeriod } from "@/lib/ai/statement";
import { reconcile, type ReconItem, type LendoPayment } from "@/lib/ai/reconcile";
import {
  loadCustomers,
  loanRef,
  suggestCustomers,
  type CustomerSuggestion,
} from "@/lib/ai/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading a multi-page statement takes a while.
export const maxDuration = 120;

const MAX_BYTES = 4 * 1024 * 1024;
const READ_ROLES = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];

export type StatementCheckResult = {
  ok: true;
  period: { from: string; to: string } | null;
  items: (ReconItem & { suggestions: CustomerSuggestion[] })[];
  lendoOnly: LendoPayment[];
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in." }, { status: 401 });
  if (!READ_ROLES.includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Not available for your role." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Please choose a statement PDF." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That PDF is too large (max 4 MB)." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    return NextResponse.json({ ok: false, error: "That file isn't a PDF." }, { status: 400 });
  }

  let pages: string[];
  try {
    pages = await pdfPages(bytes);
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't open that PDF." }, { status: 400 });
  }
  if (!pages.join("").trim()) {
    return NextResponse.json(
      { ok: false, error: "This PDF has no text (it may be a scanned image). Download the statement as a PDF from the bank app instead." },
      { status: 400 },
    );
  }

  const pay = await getPaymentDetails();
  let txns;
  try {
    txns = await readStatement(pages, [
      pay.accountName,
      "Kathleen Paul Kube",
      "Kathleen Kube",
      "Kathleen Paul",
      "KATHLEENPAUL KUBE",
    ]);
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    console.error("[statement] read failed", err);
    return NextResponse.json({ ok: false, error: "Lendo AI hit an unexpected problem." }, { status: 500 });
  }

  // Lendo records around the statement dates (with a few days' slack).
  const period = statementPeriod(pages[0] ?? "");
  const dates = txns.map((t) => t.date).sort();
  const from = new Date(`${period?.from ?? dates[0]}T00:00:00Z`);
  const to = new Date(`${period?.to ?? dates[dates.length - 1]}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 4);
  to.setUTCDate(to.getUTCDate() + 5);

  const [payments, loans] = await Promise.all([
    db.payment.findMany({
      where: { paidAt: { gte: from, lt: to } },
      select: {
        id: true,
        loanId: true,
        amount: true,
        paidAt: true,
        method: true,
        reference: true,
        loan: { select: { customer: { select: { fullName: true } } } },
      },
    }),
    db.loan.findMany({
      where: { disbursedAt: { gte: from, lt: to } },
      select: {
        id: true,
        principal: true,
        disbursedAt: true,
        reference: true,
        customer: { select: { fullName: true } },
      },
    }),
  ]);

  const { items, lendoOnly } = reconcile(
    txns,
    payments.map((p) => ({
      id: p.id,
      loanId: p.loanId,
      loanRef: loanRef(p.loanId),
      amount: Number(p.amount),
      paidOn: iso(p.paidAt),
      method: p.method,
      reference: p.reference,
      customerName: p.loan.customer.fullName,
    })),
    loans.map((l) => ({
      id: l.id,
      ref: loanRef(l.id),
      amount: Number(l.principal),
      givenOn: iso(l.disbursedAt),
      reference: l.reference,
      customerName: l.customer.fullName,
    })),
    period,
  );

  // Who each unrecorded line probably is.
  const needs = items.filter((i) => i.status === "missing_payment" || i.status === "missing_loan" || i.status === "other");
  const suggestions = await suggestCustomers(
    needs.length ? await loadCustomers() : [],
    needs.map((i) => ({ name: i.txn.name, account: i.txn.phone, amount: i.txn.amount })),
  );
  const byItem = new Map(needs.map((i, k) => [i, suggestions[k]]));

  const count = (s: ReconItem["status"]) => items.filter((i) => i.status === s).length;
  await audit({
    actorId: user.id,
    action: "ai.statement_check",
    entity: "Statement",
    entityId: period ? `${period.from}..${period.to}` : "unknown-period",
    after: {
      transactions: items.length,
      recorded: count("recorded"),
      missingPayments: count("missing_payment"),
      missingLoans: count("missing_loan"),
      other: count("other"),
      lendoOnly: lendoOnly.length,
    },
  });

  const result: StatementCheckResult = {
    ok: true,
    period,
    items: items.map((i) => ({ ...i, suggestions: byItem.get(i) ?? [] })),
    lendoOnly,
  };
  return NextResponse.json(result);
}
