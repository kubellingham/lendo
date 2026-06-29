"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Flag } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";

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
};

const columns: ColumnDef<CustomerRow>[] = [
  {
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.fullName}</span>
        {row.original.isFlagged ? (
          <Flag className="size-3.5 text-destructive" />
        ) : null}
        {row.original.businessName ? (
          <span className="text-xs text-muted-foreground">
            ({row.original.businessName})
          </span>
        ) : null}
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
    accessorKey: "activeLoans",
    header: "Active loans",
    cell: ({ row }) => row.original.activeLoans,
  },
];

export function CustomersTable({ rows }: { rows: CustomerRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No customers yet."
      onRowClick={(row) => router.push(`/customers/${row.id}`)}
    />
  );
}
