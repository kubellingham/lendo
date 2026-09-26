"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { LoanStatusBadge } from "@/components/status";
import { Input } from "@/components/ui/input";
import type { LoanStatus } from "@/generated/prisma/enums";

export type LoanRow = {
  id: string;
  customerName: string;
  principal: string; // formatted TZS
  principalNum: number; // raw, for sorting
  status: LoanStatus;
  disbursedAt: string;
  disbursedAtMs: number;
  dueAt: string;
  dueAtMs: number;
  officer: string;
  outstanding: string; // formatted TZS
  outstandingNum: number;
};

// Sort by a raw numeric/temporal field on the row while the cell shows the
// formatted string.
const byField =
  (key: keyof LoanRow) =>
  (a: { original: LoanRow }, b: { original: LoanRow }) =>
    (a.original[key] as number) - (b.original[key] as number);

const columns: ColumnDef<LoanRow>[] = [
  { accessorKey: "customerName", header: "Customer" },
  { accessorKey: "principal", header: "Principal", sortingFn: byField("principalNum") },
  {
    accessorKey: "outstanding",
    header: "Outstanding",
    sortingFn: byField("outstandingNum"),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <LoanStatusBadge status={row.original.status} />,
  },
  { accessorKey: "disbursedAt", header: "Disbursed", sortingFn: byField("disbursedAtMs") },
  { accessorKey: "dueAt", header: "Due", sortingFn: byField("dueAtMs") },
  { accessorKey: "officer", header: "Officer" },
];

const loanRef = (id: string) => "LND-" + id.slice(-6).toUpperCase();

export function LoansTable({ rows }: { rows: LoanRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.customerName, r.officer, r.status, loanRef(r.id)]
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
          placeholder="Search by customer, loan ref, officer…"
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
          {rows.length} loan{rows.length === 1 ? "" : "s"} matching “{q}”.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={
          q ? `No loans match “${q}”.` : "No loans match these filters."
        }
        onRowClick={(row) => router.push(`/loans/${row.id}`)}
      />
    </div>
  );
}
