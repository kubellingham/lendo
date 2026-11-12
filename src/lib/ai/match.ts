// Matching what a receipt says to Lendo's customers. Pure helpers here; the
// database lookups live in the server action.

/** Lowercase word list without punctuation, e.g. "ALOYCE  MASHOKO." → ["aloyce","mashoko"]. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Last 9 digits — enough to compare Tanzanian numbers written as 07…, 2557…, +2557…. */
function tail(digits: string): string {
  return digits.replace(/\D/g, "").slice(-9);
}

/**
 * An account / phone number as printed, split into the digits shown before and
 * after any masking ("01524***2000" → head "01524", tail "2000").
 * Unmasked numbers have everything in `head` and masked = false.
 */
function accountParts(raw: string): { head: string; tail: string; masked: boolean } | null {
  // Start at the first digit ("AC:01524…" → "01524…"); keep digits and mask characters.
  const s = raw.toUpperCase().replace(/^[^0-9*•]*/, "").replace(/[\s\-:]/g, "");
  const m = /^([0-9]*)[*X•.]+([0-9]*)$/.exec(s);
  if (m) return { head: m[1], tail: m[2], masked: true };
  const digits = s.replace(/\D/g, "");
  return digits ? { head: digits, tail: "", masked: false } : null;
}

/**
 * Could these two printed account numbers be the same account? Handles masked
 * numbers on either side ("01524***2000" matches "0152412342000" and another
 * "01524***2000"). Needs at least 7 visible digits in common to say yes, so a
 * short mask like "***20" never matches by chance.
 */
export function accountsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = accountParts(a);
  const y = accountParts(b);
  if (!x || !y) return false;
  if (!x.masked && !y.masked) return x.head.length >= 7 && x.head === y.head;
  const fullA = x.masked ? null : x.head;
  const fullB = y.masked ? null : y.head;
  if (fullA != null || fullB != null) {
    const full = (fullA ?? fullB)!;
    const mask = x.masked ? x : y;
    return (
      mask.head.length + mask.tail.length >= 7 &&
      full.length > mask.head.length + mask.tail.length &&
      full.startsWith(mask.head) &&
      full.endsWith(mask.tail)
    );
  }
  // Both masked: the visible parts must agree where they overlap.
  const headN = Math.min(x.head.length, y.head.length);
  const tailN = Math.min(x.tail.length, y.tail.length);
  return (
    headN + tailN >= 7 &&
    x.head.slice(0, headN) === y.head.slice(0, headN) &&
    (tailN === 0 || x.tail.slice(-tailN) === y.tail.slice(-tailN))
  );
}

/** Local phone format: "+255 754 123 456" / "255754123456" → "0754123456". */
function localPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.startsWith("255") && d.length === 12 ? "0" + d.slice(3) : d;
}

/**
 * 0–1 similarity between the name on a receipt and a customer.
 * Name words count most; a matching phone / account number lifts the score,
 * and an account this customer has paid from before is a strong match even
 * when the receipt shows no name at all.
 */
export function matchScore(
  receipt: { name: string | null; account: string | null },
  customer: {
    fullName: string;
    businessName?: string | null;
    phone: string;
    altPhone?: string | null;
    /** Accounts this customer has paid from before (as printed on receipts). */
    knownAccounts?: string[];
  },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (receipt.name) {
    const a = nameWords(receipt.name);
    const candidates = [customer.fullName, customer.businessName ?? ""].filter(Boolean);
    let best = 0;
    for (const c of candidates) {
      const b = nameWords(c);
      if (!a.length || !b.length) continue;
      const shared = a.filter((w) => b.includes(w)).length;
      best = Math.max(best, shared / Math.max(a.length, b.length));
    }
    if (best > 0) {
      score = best;
      reasons.push(best === 1 ? "Same name" : "Similar name");
    }
  }

  if (receipt.account) {
    const acct = tail(receipt.account);
    const phones = [customer.phone, customer.altPhone ?? ""].filter(Boolean);
    const phoneTails = phones.map(tail).filter((p) => p.length === 9);
    if (
      (acct.length === 9 && !/[*X•]/i.test(receipt.account) && phoneTails.includes(acct)) ||
      phones.some((p) => accountsMatch(receipt.account, localPhone(p)))
    ) {
      score = Math.min(1, score + 0.6);
      reasons.push("Same phone number");
    } else if ((customer.knownAccounts ?? []).some((k) => accountsMatch(receipt.account, k))) {
      score = Math.min(1, score + 0.7);
      reasons.push("Has paid from this account before");
    }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

/** A loan as the "which loan?" picker sees it. */
export type LoanFitInput = {
  minimumDue: number;
  interestOnly: number;
  settlement: number;
  /** Calendar days until the current round is due (negative = late). */
  daysUntilDue: number | null;
};

/**
 * Which of a person's open loans a payment most likely belongs to:
 * 1. a loan expecting exactly this amount (its minimum, interest or full balance);
 * 2. otherwise the loan due soonest (the most overdue first).
 * Returns the index and why, or null when there is nothing to choose between.
 */
export function bestLoanFit(
  amount: number | null,
  loans: LoanFitInput[],
): { index: number; reason: string } | null {
  if (loans.length < 2) return null;
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= 1;
  if (amount) {
    const exact = loans
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => near(amount, l.minimumDue) || near(amount, l.interestOnly) || near(amount, l.settlement));
    if (exact.length === 1) return { index: exact[0].i, reason: "the amount matches exactly what this loan expects" };
    if (exact.length > 1) {
      const soonest = exact.sort((a, b) => (a.l.daysUntilDue ?? 999) - (b.l.daysUntilDue ?? 999))[0];
      return { index: soonest.i, reason: "the amount matches, and this one is due first" };
    }
  }
  let best = -1;
  for (let i = 0; i < loans.length; i++) {
    const d = loans[i].daysUntilDue ?? 999;
    if (best < 0 || d < (loans[best].daysUntilDue ?? 999)) best = i;
  }
  const d = loans[best].daysUntilDue;
  return {
    index: best,
    reason: d != null && d < 0 ? "it is the most overdue" : "it is the next one due",
  };
}

/** Minimum score to suggest a customer at all. */
export const MATCH_THRESHOLD = 0.34;

/**
 * Plain-language hint about what a payment amount covers on a loan.
 * Amounts are in TSh.
 */
export function paymentHint(
  amount: number | null,
  loan: { interestOnly: number; settlement: number; cycle: number | null; isFinalRound?: boolean },
): string | null {
  if (!amount) return null;
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= 1;
  if (near(amount, loan.settlement)) return "Matches the full amount to clear this loan";
  if (amount > loan.settlement && loan.settlement > 0) return "More than this loan's full balance";
  if (loan.isFinalRound) return "Final round: the full balance is due — this is only part of it";
  if (near(amount, loan.interestOnly))
    return loan.cycle ? `Matches the interest for round ${loan.cycle}` : "Matches the interest due";
  if (amount > loan.interestOnly && loan.interestOnly > 0)
    return "Covers the interest, plus part of the principal";
  if (amount < loan.interestOnly) return "Less than the interest due (part payment)";
  return null;
}
