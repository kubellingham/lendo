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
  status: LoanStatus;
  disbursedAt: string;
  dueAt: string;
  officer: string;
  outstanding: string; // formatted TZS
};

const columns: ColumnDef<LoanRow>[] = [
  { accessorKey: "customerName", header: "Customer" },
  { accessorKey: "principal", header: "Principal" },
  { accessorKey: "outstanding", header: "Outstanding" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <LoanStatusBadge status={row.original.status} />,
  },
  { accessorKey: "disbursedAt", header: "Disbursed" },
  { accessorKey: "dueAt", header: "Due" },
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
