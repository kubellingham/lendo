import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { formatDate, formatDateTime, toIsoDate } from "@/lib/dates";
import { formatTZS, toDbString } from "@/lib/money";
import { computeLoanState } from "@/lib/loan-calc";
import {
  RecordPaymentForm,
  type InstallmentOption,
} from "@/components/payments/record-payment-form";
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
import {
  LoanStatusBadge,
  InstallmentStatusBadge,
  PunctualityBadge,
} from "@/components/status";
import { PaymentActions } from "@/components/payments/payment-actions";

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
  const user = await requireUser();
  const canWrite = WRITE_ROLES.includes(user.role);
  const { id } = await params;

  const loan = await db.loan.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, fullName: true, phone: true } },
      issuedBy: { select: { name: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        orderBy: { paidAt: "desc" },
        include: {
          recordedBy: { select: { name: true } },
          installment: { select: { dueDate: true, cycleNumber: true } },
        },
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

      {canWrite && !state.isSettled && loan.status !== "WRITTEN_OFF" ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Record payment</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              loanId={loan.id}
              defaultDate={toIsoDate(new Date())}
              defaultInstallmentId={
                (
                  loan.installments.find(
                    (i) => i.status !== "SETTLED" && i.status !== "INTEREST_PAID",
                  ) ?? loan.installments[loan.installments.length - 1]
                ).id
              }
              interestOnlyAmount={toDbString(state.interestOnlyNow)}
              settlementAmount={toDbString(state.settlementAmountNow)}
              installments={loan.installments.map<InstallmentOption>((i) => ({
                id: i.id,
                cycleNumber: i.cycleNumber,
                label: `Cycle ${i.cycleNumber} — due ${formatDate(i.dueDate)}`,
                status: i.status,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Repayment schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
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
            </div>
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
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Punctuality</TableHead>
                    <TableHead>By</TableHead>
                    {canWrite ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loan.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDate(p.paidAt)}</TableCell>
                      <TableCell>{formatTZS(p.amount.toString())}</TableCell>
                      <TableCell>{p.method}</TableCell>
                      <TableCell>
                        {p.installment ? `#${p.installment.cycleNumber}` : "—"}
                      </TableCell>
                      <TableCell>
                        <PunctualityBadge
                          paidAt={p.paidAt}
                          dueDate={p.installment?.dueDate ?? null}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.recordedBy.name}
                      </TableCell>
                      {canWrite ? (
                        <TableCell>
                          <PaymentActions
                            payment={{
                              id: p.id,
                              loanId: loan.id,
                              amount: p.amount.toString(),
                              paidAt: toIsoDate(p.paidAt),
                              method: p.method,
                              reference: p.reference,
                              note: p.note,
                              installmentId: p.installmentId,
                            }}
                            installments={loan.installments.map((i) => ({
                              id: i.id,
                              cycleNumber: i.cycleNumber,
                              label: `Cycle ${i.cycleNumber} — due ${formatDate(i.dueDate)}`,
                            }))}
                            isAdmin={user.role === "ADMIN"}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
