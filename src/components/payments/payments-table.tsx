"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";

export type PaymentRow = {
  id: string;
  loanId: string;
  date: string;
  dateMs: number;
  customer: string;
  phone: string;
  amount: string;
  amountNum: number;
  method: string;
  reference: string;
  recordedBy: string;
};

const byField =
  (key: keyof PaymentRow) =>
  (a: { original: PaymentRow }, b: { original: PaymentRow }) =>
    (a.original[key] as number) - (b.original[key] as number);

const columns: ColumnDef<PaymentRow>[] = [
  { accessorKey: "date", header: "Date", sortingFn: byField("dateMs") },
  { accessorKey: "customer", header: "Customer" },
  { accessorKey: "amount", header: "Amount", sortingFn: byField("amountNum") },
  { accessorKey: "method", header: "Method" },
  { accessorKey: "reference", header: "Reference" },
  { accessorKey: "recordedBy", header: "Recorded by" },
];

export function PaymentsTable({ rows }: { rows: PaymentRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.customer, r.phone, r.method, r.reference, r.recordedBy]
        .join(" ")
        .toLowerCase()
        .includes(s),
    );
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by customer, phone, reference…"
          className="pl-8 pr-8"
          autoFocus
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {q && filtered.length !== rows.length ? (
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-medium">{filtered.length}</span> of{" "}
          {rows.length} payment{rows.length === 1 ? "" : "s"} matching “{q}”.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={
          q ? `No payments match “${q}”.` : "No payments match these filters."
        }
        onRowClick={(row) => router.push(`/loans/${row.loanId}`)}
      />
    </div>
  );
}
