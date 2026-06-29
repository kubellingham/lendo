"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";

export type PaymentRow = {
  id: string;
  loanId: string;
  date: string;
  customer: string;
  phone: string;
  amount: string;
  method: string;
  reference: string;
  recordedBy: string;
};

const columns: ColumnDef<PaymentRow>[] = [
  { accessorKey: "date", header: "Date" },
  { accessorKey: "customer", header: "Customer" },
  { accessorKey: "amount", header: "Amount" },
  { accessorKey: "method", header: "Method" },
  { accessorKey: "reference", header: "Reference" },
  { accessorKey: "recordedBy", header: "Recorded by" },
];

export function PaymentsTable({ rows }: { rows: PaymentRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No payments match these filters."
      onRowClick={(row) => router.push(`/loans/${row.loanId}`)}
    />
  );
}
