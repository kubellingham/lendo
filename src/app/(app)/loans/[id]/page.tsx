import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatTZS } from "@/lib/money";
import { computeLoanState } from "@/lib/loan-calc";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoanStatusBadge, InstallmentStatusBadge } from "@/components/status";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const loan = await db.loan.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, fullName: true, phone: true } },
      issuedBy: { select: { name: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        orderBy: { paidAt: "desc" },
        include: { recordedBy: { select: { name: true } } },
      },
    },
  });
  if (!loan) notFound();

  const state = computeLoanState({
    principal: loan.principal,
    status: loan.status,
    installments: loan.installments,
    payments: loan.payments.map((p) => ({
      amount: p.amount,
      installmentId: p.installmentId,
    })),
  });

  return (
    <>
      <PageHeader
        title={`Loan · ${formatTZS(loan.principal.toString())}`}
        action={<LoanStatusBadge status={loan.status} />}
      />

      <p className="-mt-4 mb-6 text-sm text-muted-foreground">
        Borrower:{" "}
        <Link
          href={`/customers/${loan.customer.id}`}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {loan.customer.fullName}
        </Link>{" "}
        · {loan.customer.phone} · Disbursed {formatDate(loan.disbursedAt)} · Due{" "}
        {formatDate(loan.dueAt)} · Issued by {loan.issuedBy.name}
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Principal" value={formatTZS(loan.principal.toString())} />
        <Stat label="Collected" value={formatTZS(state.totalCollected)} />
        <Stat
          label="Principal outstanding"
          value={formatTZS(state.principalOutstanding)}
        />
        <Stat
          label="Settlement amount now"
          value={state.isSettled ? "—" : formatTZS(state.settlementAmountNow)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Repayment schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Interest</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.installments.map((inst) => (
                  <TableRow key={inst.id}>
                    <TableCell>{inst.cycleNumber}</TableCell>
                    <TableCell>{formatDate(inst.dueDate)}</TableCell>
                    <TableCell>
                      {formatTZS(inst.expectedInterest.toString())}
                    </TableCell>
                    <TableCell>
                      {formatTZS(state.perInstallmentPaid[inst.id] ?? "0")}
                    </TableCell>
                    <TableCell>
                      <InstallmentStatusBadge status={inst.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments ({loan.payments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loan.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No payments recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loan.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDateTime(p.paidAt)}</TableCell>
                      <TableCell>{formatTZS(p.amount.toString())}</TableCell>
                      <TableCell>{p.method}</TableCell>
                      <TableCell>{p.recordedBy.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
