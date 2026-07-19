import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { formatTZS, money, round2 } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import {
  interestByMonth,
  monthsRange,
  periodLabel,
  DEFAULT_TITHE_RATE_PCT,
  type TitheLoan,
} from "@/lib/tithes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TitheRowActions } from "@/components/tithes/tithe-actions";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="stat-value mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function TithesPage() {
  const user = await requireUser();
  // Interest/profit is sensitive; restrict to ADMIN + ACCOUNTANT.
  if (user.role !== "ADMIN" && user.role !== "ACCOUNTANT") {
    redirect("/dashboard?denied=1");
  }
  const canSubmit = user.role === "ADMIN";

  const [loans, submissions] = await Promise.all([
    db.loan.findMany({
      include: {
        installments: { orderBy: { cycleNumber: "asc" } },
        payments: {
          select: {
            id: true,
            amount: true,
            installmentId: true,
            paidAt: true,
            createdAt: true,
          },
        },
      },
    }),
    db.tithePayment.findMany(),
  ]);

  const monthly = interestByMonth(loans as unknown as TitheLoan[]);
  const submittedBy = new Map(submissions.map((s) => [s.period, s]));

  const earliest =
    monthly.size > 0 ? [...monthly.keys()].sort()[0] : null;
  const periods = monthsRange(earliest);

  // Totals.
  let totalInterest = money(0);
  let totalTithe = money(0);
  let pendingTithe = money(0);
  for (const period of periods) {
    const interest = monthly.get(period) ?? money(0);
    const tithe = round2(interest.times(DEFAULT_TITHE_RATE_PCT).div(100));
    totalInterest = totalInterest.plus(interest);
    totalTithe = totalTithe.plus(tithe);
    if (!submittedBy.has(period)) pendingTithe = pendingTithe.plus(tithe);
  }

  return (
    <>
      <PageHeader
        title="Tithes"
        description={`Interest earned each month and ${DEFAULT_TITHE_RATE_PCT}% set aside as tithes.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Total interest (all time)" value={formatTZS(totalInterest)} />
        <Stat
          label={`Total tithe (${DEFAULT_TITHE_RATE_PCT}%)`}
          value={formatTZS(totalTithe)}
        />
        <Stat label="Tithe still pending" value={formatTZS(pendingTithe)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Interest earned</TableHead>
                  <TableHead className="text-right">
                    Tithe ({DEFAULT_TITHE_RATE_PCT}%)
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const interest = monthly.get(period) ?? money(0);
                  const tithe = round2(
                    interest.times(DEFAULT_TITHE_RATE_PCT).div(100),
                  );
                  const sub = submittedBy.get(period);
                  return (
                    <TableRow key={period}>
                      <TableCell className="font-medium">
                        {periodLabel(period)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatTZS(interest)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatTZS(
                          sub ? sub.amount.toString() : tithe,
                        )}
                      </TableCell>
                      <TableCell>
                        {sub ? (
                          <div className="flex flex-col">
                            <Badge variant="success">Submitted</Badge>
                            <span className="mt-1 text-xs text-muted-foreground">
                              {formatDateTime(sub.submittedAt)} ·{" "}
                              {sub.submittedByName}
                            </span>
                          </div>
                        ) : interest.gt(0) ? (
                          <Badge variant="warning">Pending</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No interest
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {interest.gt(0) || sub ? (
                          <TitheRowActions
                            period={period}
                            submitted={!!sub}
                            canSubmit={canSubmit}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {periods.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No interest has been collected yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Interest is the profit portion of each payment (charged before
        principal). Submitting a month records the tithe amount and who set it
        aside; you can undo if needed.
      </p>
    </>
  );
}
