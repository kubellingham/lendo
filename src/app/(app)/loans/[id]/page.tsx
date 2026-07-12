import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { formatDate, formatDateTime, toIsoDate } from "@/lib/dates";
import { formatTZS, money, toDbString } from "@/lib/money";
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
import { LoanActions } from "@/components/loans/loan-actions";
import { SendMessage } from "@/components/messaging/send-message";

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
    interestRatePct: loan.interestRatePct,
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
        action={
          <div className="flex flex-wrap items-center gap-2">
            <LoanStatusBadge status={loan.status} />
            <SendMessage
              context={{ kind: "loan", loanId: loan.id }}
              defaultTemplateKey={
                loan.status === "SETTLED"
                  ? "loan_settled"
                  : loan.status === "OVERDUE" || loan.status === "DEFAULTED"
                    ? "overdue"
                    : "reminder_3d"
              }
            />
            {canWrite ? (
              <LoanActions
                loan={{
                  id: loan.id,
                  principal: loan.principal.toString(),
                  disbursedAt: toIsoDate(loan.disbursedAt),
                }}
                isAdmin={user.role === "ADMIN"}
                hasPayments={loan.payments.length > 0}
              />
            ) : null}
          </div>
        }
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
                  <TableHead>Opening principal</TableHead>
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
                      {formatTZS(
                        state.perInstallmentOpeningPrincipal[inst.id] ?? "0",
                      )}
                    </TableCell>
                    <TableCell>
                      {formatTZS(
                        state.perInstallmentInterestOwed[inst.id] ??
                          inst.expectedInterest.toString(),
                      )}
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
            <p className="mt-3 text-xs text-muted-foreground">
              Interest is 15% of the opening principal each cycle. Paying more
              than interest reduces the principal, which lowers next cycle&apos;s interest.
            </p>
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
                          <div className="flex items-center gap-1">
                            <SendMessage
                              context={{ kind: "payment", paymentId: p.id }}
                              triggerLabel="Receipt"
                              triggerVariant="ghost"
                            />
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
                          </div>
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

      {loan.payments.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Payments by cycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loan.installments.map((inst) => {
              const paymentsInCycle = [...loan.payments]
                .filter((p) => p.installmentId === inst.id)
                .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
              if (paymentsInCycle.length === 0 && inst.status === "PENDING") {
                return null;
              }
              const interestOwed = money(
                state.perInstallmentInterestOwed[inst.id] ?? "0",
              );
              const paidThisCycle = money(
                state.perInstallmentPaid[inst.id] ?? "0",
              );
              const interestCovered = paidThisCycle.gte(interestOwed)
                ? interestOwed
                : paidThisCycle;
              const principalFromThisCycle = paidThisCycle.gt(interestOwed)
                ? paidThisCycle.minus(interestOwed)
                : money("0");
              const interestRemaining = interestOwed.minus(interestCovered);
              const pct = interestOwed.gt(0)
                ? Number(
                    interestCovered
                      .div(interestOwed)
                      .times(100)
                      .toDecimalPlaces(0)
                      .toString(),
                  )
                : 100;
              return (
                <div key={inst.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium">
                      Cycle {inst.cycleNumber} · due {formatDate(inst.dueDate)}
                    </div>
                    <InstallmentStatusBadge status={inst.status} />
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                    <div>
                      <div>Interest owed</div>
                      <div className="text-sm font-medium text-foreground">
                        {formatTZS(interestOwed)}
                      </div>
                    </div>
                    <div>
                      <div>Interest covered</div>
                      <div className="text-sm font-medium text-foreground">
                        {formatTZS(interestCovered)}
                      </div>
                    </div>
                    <div>
                      <div>Applied to principal</div>
                      <div className="text-sm font-medium text-foreground">
                        {formatTZS(principalFromThisCycle)}
                      </div>
                    </div>
                    <div>
                      <div>
                        {interestRemaining.lte(0)
                          ? "Cycle can roll"
                          : "Still owed to roll"}
                      </div>
                      <div
                        className={`text-sm font-medium ${
                          interestRemaining.lte(0)
                            ? "text-emerald-600"
                            : "text-destructive"
                        }`}
                      >
                        {interestRemaining.lte(0)
                          ? "✓"
                          : formatTZS(interestRemaining)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={`h-1.5 rounded-full ${
                        pct >= 100 ? "bg-emerald-500" : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  {paymentsInCycle.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm">
                      {paymentsInCycle.map((p, idx) => (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border-l-2 border-muted-foreground/20 py-1 pl-2 pr-1"
                        >
                          <div className="text-xs text-muted-foreground">
                            Payment #{idx + 1} · {formatDate(p.paidAt)} ·{" "}
                            {p.method}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </div>
                          <span className="font-medium">
                            {formatTZS(p.amount.toString())}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No payments in this cycle yet.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
