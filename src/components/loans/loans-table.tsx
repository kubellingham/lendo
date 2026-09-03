"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { LoanStatusBadge } from "@/components/status";
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

export function LoansTable({ rows }: { rows: LoanRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No loans match these filters."
      onRowClick={(row) => router.push(`/loans/${row.id}`)}
    />
  );
}
