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
 * 0–1 similarity between the name on a receipt and a customer.
 * Name words count most; a matching phone / account number lifts the score.
 */
export function matchScore(
  receipt: { name: string | null; account: string | null },
  customer: { fullName: string; businessName?: string | null; phone: string; altPhone?: string | null },
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
    const phones = [customer.phone, customer.altPhone ?? ""].map(tail).filter((p) => p.length === 9);
    if (acct.length === 9 && phones.includes(acct)) {
      score = Math.min(1, score + 0.6);
      reasons.push("Same phone number");
    }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

/** Minimum score to suggest a customer at all. */
export const MATCH_THRESHOLD = 0.34;

/**
 * Plain-language hint about what a payment amount covers on a loan.
 * Amounts are in TSh.
 */
export function paymentHint(
  amount: number | null,
  loan: { interestOnly: number; settlement: number; cycle: number | null },
): string | null {
  if (!amount) return null;
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= 1;
  if (near(amount, loan.settlement)) return "Matches the full amount to clear this loan";
  if (near(amount, loan.interestOnly))
    return loan.cycle ? `Matches the interest for round ${loan.cycle}` : "Matches the interest due";
  if (amount > loan.settlement && loan.settlement > 0) return "More than this loan's full balance";
  if (amount > loan.interestOnly && loan.interestOnly > 0)
    return "Covers the interest, plus part of the principal";
  if (amount < loan.interestOnly) return "Less than the interest due (part payment)";
  return null;
}
