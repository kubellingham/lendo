"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Flag, Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { RiskChip } from "@/components/customers/risk-meter";
import type { RiskBand } from "@/generated/prisma/enums";

export type CustomerRow = {
  id: string;
  fullName: string;
  businessName: string | null;
  type: "INDIVIDUAL" | "BUSINESS";
  phone: string;
  city: string;
  region: string;
  isFlagged: boolean;
  activeLoans: number;
  riskScore: number;
  riskBand: RiskBand;
};

const columns: ColumnDef<CustomerRow>[] = [
  {
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <Avatar
          name={row.original.fullName}
          size="sm"
          tone={row.original.isFlagged ? "danger" : "default"}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{row.original.fullName}</span>
            {row.original.isFlagged ? (
              <Flag className="size-3.5 text-destructive" />
            ) : null}
          </div>
          {row.original.businessName ? (
            <div className="text-xs text-muted-foreground">
              {row.original.businessName}
            </div>
          ) : null}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline">
        {row.original.type === "BUSINESS" ? "Business" : "Individual"}
      </Badge>
    ),
  },
  { accessorKey: "phone", header: "Phone" },
  {
    id: "location",
    header: "Location",
    cell: ({ row }) => `${row.original.city}, ${row.original.region}`,
  },
  {
    accessorKey: "riskScore",
    header: "Score",
    cell: ({ row }) => (
      <RiskChip score={row.original.riskScore} band={row.original.riskBand} />
    ),
  },
  {
    accessorKey: "activeLoans",
    header: "Active loans",
    cell: ({ row }) => row.original.activeLoans,
  },
];

export function CustomersTable({
  rows,
  initialQuery = "",
}: {
  rows: CustomerRow[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const haystack = [
        r.fullName,
        r.businessName ?? "",
        r.phone,
        r.city,
        r.region,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(s);
    });
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, business, city…"
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
          {rows.length} customer{rows.length === 1 ? "" : "s"} matching “{q}”.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={
          q
            ? `No customers match “${q}”.`
            : "No customers yet."
        }
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
      />
    </div>
  );
}
