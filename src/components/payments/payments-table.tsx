"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";

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
  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No payments match these filters."
      onRowClick={(row) => router.push(`/loans/${row.loanId}`)}
    />
  );
}
