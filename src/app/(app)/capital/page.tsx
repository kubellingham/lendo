import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { loadCashPool } from "@/lib/cash-pool";
import { formatTZS } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddCapitalButton,
  CapitalRowActions,
} from "@/components/capital/capital-forms";

const TYPE_LABEL: Record<string, string> = {
  BORROWED: "Borrowed",
  INVESTMENT: "Investment",
  OWN_FUNDS: "Own funds",
  OTHER: "Other",
};

function Stat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "primary";
  sub?: string;
}) {
  const tones: Record<string, string> = {
    default: "border-slate-200 bg-white",
    primary: "border-slate-200 bg-slate-50",
    success: "border-emerald-200 bg-emerald-50",
    danger: "border-red-200 bg-red-50",
  };
  const valueTone: Record<string, string> = {
    default: "text-slate-900",
    primary: "text-slate-900",
    success: "text-emerald-700",
    danger: "text-red-700",
  };
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${tones[tone]}`}>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className={`stat-value mt-1.5 text-2xl font-semibold ${valueTone[tone]}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function FlowRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t py-2 text-sm first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default async function CapitalPage() {
  const user = await requireUser();
  if (
    user.role !== "ADMIN" &&
    user.role !== "ACCOUNTANT" &&
    user.role !== "VIEWER"
  ) {
    redirect("/dashboard?denied=1");
  }
  const isAdmin = user.role === "ADMIN";
  const canWrite = user.role === "ADMIN" || user.role === "ACCOUNTANT";

  const pool = await loadCashPool();
  const {
    rows,
    capitalRaised,
    capitalRepaid,
    capitalOwed,
    disbursed,
    principalOutstanding,
    customerCollected,
    tithesPaid,
    cashIn,
    cashOut,
    cashOnHand,
  } = pool;
  const sources = rows.map((r) => r.s);

  return (
    <>
      <PageHeader
        title="Capital & cash pool"
        description="Where the money comes from, and where it went."
        action={canWrite ? <AddCapitalButton /> : null}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Cash on hand"
          value={formatTZS(cashOnHand)}
          tone={cashOnHand.lt(0) ? "danger" : "success"}
          sub="Money in minus money out"
        />
        <Stat
          label="Capital raised"
          value={formatTZS(capitalRaised)}
          tone="primary"
          sub={`${sources.length} source${sources.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Capital still owed"
          value={formatTZS(capitalOwed)}
          tone={capitalOwed.gt(0) ? "danger" : "default"}
          sub="Borrowed / investment not repaid"
        />
        <Stat
          label="Out on loan"
          value={formatTZS(principalOutstanding)}
          sub="Principal with customers"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownLeft className="size-4 text-emerald-600" /> Money in
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FlowRow label="Capital raised" value={formatTZS(capitalRaised)} />
            <FlowRow
              label="Collected from customers"
              value={formatTZS(customerCollected)}
            />
            <FlowRow label="Total in" value={formatTZS(cashIn)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpRight className="size-4 text-red-600" /> Money out
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FlowRow label="Disbursed to customers" value={formatTZS(disbursed)} />
            <FlowRow label="Capital repaid" value={formatTZS(capitalRepaid)} />
            <FlowRow label="Tithes set aside" value={formatTZS(tithesPaid)} />
            <FlowRow label="Total out" value={formatTZS(cashOut)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capital sources ({sources.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Repaid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ s, amount, repaid, outstanding }) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.sourceName}
                      {s.notes ? (
                        <div className="text-xs text-muted-foreground">
                          {s.notes}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TYPE_LABEL[s.type]}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(s.receivedAt)}</TableCell>
                    <TableCell>{s.dueAt ? formatDate(s.dueAt) : "—"}</TableCell>
                    <TableCell>
                      {s.interestRatePct
                        ? `${Number(s.interestRatePct)}%${s.rateNote ? ` ${s.rateNote}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatTZS(amount)}</TableCell>
                    <TableCell className="text-right">{formatTZS(repaid)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {outstanding.lte(0) ? (
                        <Badge variant="success">Cleared</Badge>
                      ) : (
                        formatTZS(outstanding)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite ? (
                        <CapitalRowActions
                          sourceId={s.id}
                          sourceName={s.sourceName}
                          isAdmin={isAdmin}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {sources.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No capital recorded yet. Use “Record capital” to add money
                      the business has received.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
