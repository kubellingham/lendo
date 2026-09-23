"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { setCustomerReferral } from "@/lib/actions/referral-actions";
import { cn } from "@/lib/utils";

export type ToggleCustomer = {
  id: string;
  fullName: string;
  phone: string;
  currentReferralId: string | null;
  currentReferralName: string | null;
};

export function CustomerToggleList({
  referralId,
  referralName,
  customers,
}: {
  referralId: string;
  referralName: string;
  customers: ToggleCustomer[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(
      (c) =>
        c.fullName.toLowerCase().includes(s) ||
        c.phone.toLowerCase().includes(s),
    );
  }, [customers, q]);

  const linkedCount = customers.filter(
    (c) => c.currentReferralId === referralId,
  ).length;

  function onToggle(c: ToggleCustomer) {
    const on = c.currentReferralId === referralId;
    // If they already belong to a different referral, confirm before overwriting.
    if (
      !on &&
      c.currentReferralId &&
      c.currentReferralId !== referralId &&
      c.currentReferralName
    ) {
      const ok = confirm(
        `${c.fullName} is currently vouched by ${c.currentReferralName}. ` +
          `Reassign to ${referralName}?`,
      );
      if (!ok) return;
    }
    setBusyId(c.id);
    setError(null);
    start(async () => {
      const res = await setCustomerReferral(c.id, on ? null : referralId);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Currently vouching for{" "}
          <span className="font-semibold text-foreground">{linkedCount}</span>{" "}
          customer{linkedCount === 1 ? "" : "s"}.
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers…"
            className="h-9 w-64 pl-8"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border bg-card">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No customers match your search.
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((c) => {
              const on = c.currentReferralId === referralId;
              const otherReferral =
                c.currentReferralId && !on ? c.currentReferralName : null;
              const isBusy = busyId === c.id && pending;
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
                >
                  <Avatar name={c.fullName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.fullName}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {c.phone}
                      </span>
                    </div>
                    {otherReferral ? (
                      <div className="text-xs text-amber-700">
                        Currently vouched by {otherReferral}
                      </div>
                    ) : c.currentReferralId ? null : (
                      <div className="text-xs text-muted-foreground">
                        No referral
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => onToggle(c)}
                    disabled={isBusy}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      on
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-slate-300 hover:bg-slate-400",
                      isBusy && "opacity-50",
                    )}
                    title={on ? "Tap to unlink" : "Tap to vouch for this customer"}
                  >
                    <span
                      className={cn(
                        "inline-block size-5 rounded-full bg-white shadow transition-transform",
                        on ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                    {on ? (
                      <Check className="absolute left-1 top-0.5 size-4 text-white" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
