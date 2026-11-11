// Links that open Lendo's normal forms pre-filled with what Lendo AI read.
// Staff review and save there — nothing is saved by following a link.

export type Prefill = {
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  reference: string | null;
  method?: string | null;
  name?: string | null;
  account?: string | null;
};

export function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
}

export function issueLoanHref(r: Prefill, customerId?: string) {
  return `/loans/new?${qs({
    customerId,
    principal: r.amount,
    disbursedAt: r.date,
    reference: r.reference,
    ai: 1,
  })}`;
}

/** New customer form; after saving it continues to the pre-filled loan form. */
export function newCustomerHref(r: Prefill) {
  return `/customers/new?${qs({
    fullName: r.name,
    phone: r.account,
    ai: 1,
    return: issueLoanHref(r),
  })}`;
}

export function recordPaymentHref(r: Prefill, loanId: string) {
  return `/loans/${loanId}?${qs({
    amount: r.amount,
    paidAt: r.date,
    method: r.method,
    reference: r.reference,
    ai: 1,
  })}#record-payment`;
}

export function findCustomerHref(name: string | null | undefined) {
  return `/customers?${qs({ q: name?.split(/\s+/)[0] ?? "" })}`;
}
