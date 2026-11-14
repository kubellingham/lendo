import Decimal from "decimal.js";
import { computeLoanState } from "@/lib/loan-calc";
import { attributeInterest, type InterestInput } from "@/lib/reporting";
import { formatDate, toIsoDate } from "@/lib/dates";
import { loanSituation, situationSummary, type SituationLoan } from "@/lib/loan-situation";
import type { Fact } from "@/lib/message-check";

// ---------------------------------------------------------------------------
// "Write my own" messages: staff say what they want in their own words, and
// Lendo AI writes it properly — using ONLY this loan's records, which are also
// what the finished message is checked against.
// ---------------------------------------------------------------------------

export type CustomTone = "warm" | "formal" | "firm";
export type CustomLanguage = "sw" | "en";

export type FactsLoan = SituationLoan &
  InterestInput & {
    id: string;
    disbursedAt: Date;
    customer: { fullName: string };
    payments: (InterestInput["payments"][number] & { method: string })[];
  };

const METHOD: Record<string, string> = {
  CASH: "cash",
  MPESA: "mobile money",
  BANK: "bank transfer",
  OTHER: "other",
};

const tsh = (n: Decimal | number) =>
  `TSh ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(Number(n)))}`;
const amountKey = (n: Decimal | number) => String(Math.round(Number(n)));

export function loanRef(id: string) {
  return "LND-" + id.slice(-6).toUpperCase();
}

/** Everything the message may mention, as labelled facts. */
export function buildLoanFacts(
  loan: FactsLoan,
  pay: { bank: string; accountName: string; accountNumber: string },
  brand: { name: string; phone: string },
  now: Date = new Date(),
): Fact[] {
  const facts: Fact[] = [];
  const add = (group: string, label: string, kind: Fact["kind"], value: string, key: string) =>
    facts.push({ group, label, kind, value, key });
  const money = (group: string, label: string, n: Decimal | number) => add(group, label, "amount", tsh(n), amountKey(n));
  const date = (group: string, label: string, d: Date) => add(group, label, "date", formatDate(d, "d MMM yyyy"), toIsoDate(d));
  const num = (group: string, label: string, n: number) => add(group, label, "number", String(n), String(n));

  const state = computeLoanState(loan);
  const sit = loanSituation(loan, now);
  const interestByPayment = attributeInterest(loan);

  // Loan
  const first = loan.customer.fullName.trim().split(/\s+/)[0] ?? loan.customer.fullName;
  add("Customer", "First name", "text", first, first);
  add("Loan", "Loan reference", "ref", loanRef(loan.id), loanRef(loan.id));
  money("Loan", "Amount lent", loan.principal);
  date("Loan", "Date the loan was given", loan.disbursedAt);
  num("Loan", "Interest rate per 30-day round (%)", Number(loan.interestRatePct));
  num("Loan", "Rounds agreed", loan.cyclesAllowed);
  date("Loan", "Final due date", loan.dueAt);

  // Where it stands now
  if (sit.settled) {
    add("Now", "Status", "text", "fully repaid", "fully repaid");
  } else {
    if (sit.round != null) num("Now", "Current round", sit.round);
    if (sit.dueDate) date("Now", `Round ${sit.round} due date`, sit.dueDate);
    if (sit.daysUntilDue != null) {
      if (sit.daysUntilDue >= 0) num("Now", "Days until it is due", sit.daysUntilDue);
      else num("Now", "Days late", -sit.daysUntilDue);
    }
    money("Now", "Loan balance still owed (without interest)", sit.principalOutstanding);
    money("Now", `Interest still owed for round ${sit.round}`, sit.interestDue);
    money("Now", "Amount to clear the whole loan now (balance + interest)", sit.toClear);
    if (sit.fullBalanceDue) {
      add("Now", "What must be paid", "text", "the full balance (final round)", "full");
    } else {
      money("Now", "Minimum to pay now", sit.minimumDue);
    }
    if (sit.overdueRounds.length) {
      money("Now", `Overdue now (unpaid interest for round${sit.overdueRounds.length > 1 ? "s" : ""} ${sit.overdueRounds.join(", ")})`, sit.amountOverdue);
    }
  }

  // Round by round
  for (const i of loan.installments) {
    const g = `Round ${i.cycleNumber}`;
    const owed = state.perInstallmentInterestOwed[i.id] ?? new Decimal(0);
    const paidTowards = state.perInstallmentPaid[i.id] ?? new Decimal(0);
    date(g, `Round ${i.cycleNumber} due date`, i.dueDate);
    money(g, `Round ${i.cycleNumber} opening loan balance`, state.perInstallmentOpeningPrincipal[i.id] ?? 0);
    money(g, `Round ${i.cycleNumber} interest charged`, owed);
    money(g, `Round ${i.cycleNumber} interest paid`, Decimal.min(owed, paidTowards));
    const unpaid = Decimal.max(0, owed.minus(paidTowards));
    if (unpaid.gt(0.5) && i.dueDate <= now) money(g, `Round ${i.cycleNumber} interest still unpaid`, unpaid);
  }

  // Each payment and how it was used (interest first, then the loan balance)
  const ordered = [...loan.payments].sort(
    (a, b) => a.paidAt.getTime() - b.paidAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  let interestPaid = new Decimal(0);
  ordered.forEach((p, k) => {
    const g = `Payment ${k + 1}`;
    const interest = interestByPayment.get(p.id) ?? new Decimal(0);
    const principalPart = Decimal.max(0, new Decimal(p.amount.toString()).minus(interest));
    interestPaid = interestPaid.plus(interest);
    const round = loan.installments.find((i) => i.id === p.installmentId)?.cycleNumber;
    date(g, `Payment ${k + 1} date`, p.paidAt);
    money(g, `Payment ${k + 1} amount`, new Decimal(p.amount.toString()));
    money(g, `Payment ${k + 1}: part that paid interest${round ? ` (round ${round})` : ""}`, interest);
    money(g, `Payment ${k + 1}: part that reduced the loan balance`, principalPart);
    add(g, `Payment ${k + 1} method`, "text", METHOD[p.method] ?? p.method, p.method);
  });
  if (ordered.length) {
    num("Totals", "Number of payments made", ordered.length);
    money("Totals", "Total paid so far", state.totalCollected);
    money("Totals", "Total interest paid so far", interestPaid);
    money("Totals", "Total that reduced the loan balance", state.principalCollected);
  }

  // How to pay
  add("How to pay", "Bank", "text", pay.bank, pay.bank);
  add("How to pay", "Account name", "text", pay.accountName, pay.accountName);
  add("How to pay", "Account number", "account", pay.accountNumber, pay.accountNumber);
  if (brand.phone) add("How to pay", "Lendo phone number", "account", brand.phone, brand.phone);
  add("How to pay", "Business name (sign-off)", "text", brand.name, brand.name);

  // Today, for timing words
  date("Today", "Today's date", now);
  facts.push({ group: "Today", label: "Situation summary", kind: "text", value: situationSummary(sit), key: "summary" });
  return facts;
}

/** The facts as the AI reads them: grouped "- Label: value" lines. */
export function factsText(facts: Fact[]): string {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) groups.set(f.group ?? "", [...(groups.get(f.group ?? "") ?? []), f]);
  return [...groups.entries()]
    .map(([g, list]) => `${g}:\n${list.map((f) => `- ${f.label}: ${f.value}`).join("\n")}`)
    .join("\n\n");
}

const TONE: Record<CustomTone, string> = {
  warm: "warm, friendly and patient — like a helpful person who knows them; thank them where it fits",
  formal: "formal and professional — courteous and precise, like a letter from a finance office",
  firm: "firm and direct about what must be paid and by when — still polite: no threats, no insults, no shaming",
};

export function composePrompt(input: {
  language: CustomLanguage;
  tone: CustomTone;
  facts: Fact[];
  now?: Date;
}): string {
  const sw = input.language === "sw";
  const first = input.facts.find((f) => f.label === "First name")?.value ?? "";
  const brand = input.facts.find((f) => f.label.startsWith("Business name"))?.value ?? "Lendo";
  return `You write a WhatsApp message from ${brand} (a small lending business in Tanzania) to one of its borrowers. A staff member tells you, in their own words, what they want to say; you turn it into a clear, well-written message the borrower will understand.

Right now it is ${formatDate(input.now ?? new Date(), "EEEE d MMMM yyyy, HH:mm")}.

How the loans work: 15% interest per 30-day round on the loan balance still owed. Each payment first pays that round's interest; anything above the interest reduces the loan balance. The final round must be paid in full (the remaining balance plus that round's interest).

The loan's records — the ONLY source for amounts, dates, rounds and references:
${factsText(input.facts)}

Write the message in ${
    sw
      ? `natural, everyday Kiswahili as spoken in Tanzania (interest = "riba"; loan balance = "salio la mkopo"; round = "raundi"; to clear the loan = "kumaliza mkopo"; due date = "tarehe ya mwisho ya kulipa"; tomorrow = "kesho"; today = "leo")`
      : "simple, clear English"
  }. Tone: ${TONE[input.tone]}. Address ${first} by first name.

Rules:
- Say what the staff member wants to say. Their note may be short, rough, mixed English/Kiswahili or have typos — understand it and write it properly. It is guidance for you, not text to copy.
- Every amount, date, round number and reference you write must come from the records above, written exactly as there. Never invent, estimate or round a number. Do not add up or subtract numbers yourself — if a total is needed, use one from the records.
- Never add fees, penalties, deadlines, legal threats or promises that are not in the records or the note.
- If the note's numbers or dates disagree with the records, use the records and mention it in staff_notes.
- When explaining payments, be concrete: which payment (date and amount), how much of it paid interest, how much reduced the loan balance, what is still owed and by when.
- When asking for a payment, end with the payment details (bank, account name, account number) as a short separate block.
- WhatsApp style: *bold* with single asterisks, short lines, bullet points with •. Keep it short — about 12 lines plus the payment block.
- End with the sign-off "— ${brand}".

Reply with ONLY a JSON object, no other text:
{"message": "the WhatsApp message", "staff_notes": ["short notes for the staff member only — e.g. a number in their note that didn't match the records; [] if none"]}`;
}
