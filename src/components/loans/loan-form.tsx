"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { loanSchema, type LoanInput } from "@/lib/validation";
import { issueLoan, type LoanActionResult } from "@/lib/actions/loan-actions";
import { generateSchedule } from "@/lib/schedule";
import { parseIsoDate, toIsoDate, formatDate } from "@/lib/dates";
import { formatTZS } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

export type CustomerOption = {
  id: string;
  label: string;
  isBlacklisted: boolean;
};

export function LoanForm({
  customers,
  preselectedCustomerId,
}: {
  customers: CustomerOption[];
  preselectedCustomerId?: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState(false);
  const [canOverride, setCanOverride] = useState(false);

  const today = toIsoDate(new Date());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoanInput>({
    resolver: zodResolver(loanSchema),
    defaultValues: {
      customerId: preselectedCustomerId ?? "",
      principal: "",
      disbursedAt: today,
      overrideBlacklist: false,
      overrideReason: "",
    },
  });

  const principal = watch("principal");
  const disbursedAt = watch("disbursedAt");

  const preview = useMemo(() => {
    const amount = Number(principal);
    if (!principal || Number.isNaN(amount) || amount <= 0 || !disbursedAt) {
      return null;
    }
    try {
      return generateSchedule({
        principal,
        disbursedAt: parseIsoDate(disbursedAt),
      });
    } catch {
      return null;
    }
  }, [principal, disbursedAt]);

  async function onSubmit(values: LoanInput) {
    setFormError(null);
    try {
      const res: LoanActionResult = await issueLoan(values);
      if (res.ok) {
        if (res.redirectTo) router.push(res.redirectTo);
        return;
      }
      setFormError(res.error);
      if (res.requiresOverride) {
        setNeedsOverride(true);
        setCanOverride(!!res.canOverride);
      }
    } catch (err) {
      console.error("[loan-form] submit error", err);
      setFormError(
        err instanceof Error
          ? `Save failed: ${err.message}`
          : "Save failed (unknown error).",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Loan details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Customer</Label>
              <Link
                href="/customers/new?return=/loans/new"
                className="text-xs text-primary hover:underline"
              >
                Can&apos;t find them? + Add new customer
              </Link>
            </div>
            <Select
              {...register("customerId")}
              disabled={!!preselectedCustomerId}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.isBlacklisted ? " — BLACKLISTED" : ""}
                </option>
              ))}
            </Select>
            {errors.customerId ? (
              <p className="text-xs text-destructive">
                {errors.customerId.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Principal (TZS)</Label>
            <Input
              {...register("principal")}
              inputMode="decimal"
              placeholder="100000"
            />
            {errors.principal ? (
              <p className="text-xs text-destructive">
                {errors.principal.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Disbursal date</Label>
            <Input {...register("disbursedAt")} type="date" />
            {errors.disbursedAt ? (
              <p className="text-xs text-destructive">
                {errors.disbursedAt.message}
              </p>
            ) : null}
          </div>

          {needsOverride && canOverride ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">
                Customer is blacklisted
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  onChange={(e) =>
                    setValue("overrideBlacklist", e.target.checked)
                  }
                />
                I confirm I am overriding the blacklist (this will be audit-logged).
              </label>
              <Textarea
                {...register("overrideReason")}
                placeholder="Reason for override (required)"
                rows={2}
              />
            </div>
          ) : null}

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Issuing…" : "Issue loan"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Repayment schedule preview</CardTitle>
        </CardHeader>
        <CardContent>
          {preview ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Interest</TableHead>
                    <TableHead>Settle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.installments.map((inst) => (
                    <TableRow key={inst.cycleNumber}>
                      <TableCell>{inst.cycleNumber}</TableCell>
                      <TableCell>{formatDate(inst.dueDate)}</TableCell>
                      <TableCell>{formatTZS(inst.interestOnlyAmount)}</TableCell>
                      <TableCell>
                        {formatTZS(inst.fullSettlementAmount)}
                        {inst.isMandatorySettlement ? " *" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Interest per cycle</dt>
                  <dd>{formatTZS(preview.perCycleInterest)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Max total interest</dt>
                  <dd>{formatTZS(preview.maxTotalInterest)}</dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Max total repayment</dt>
                  <dd>{formatTZS(preview.maxTotalRepayment)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                * settlement is mandatory at the final cycle (day 90).
                <br />
                Interest is 15% of the outstanding principal each cycle. If the
                borrower pays down principal early, the interest for the
                remaining cycles drops accordingly.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a principal and disbursal date to preview the schedule.
            </p>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
