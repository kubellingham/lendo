"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { paymentSchema, type PaymentInput } from "@/lib/validation";
import { recordPayment } from "@/lib/actions/payment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PaymentMethod, type InstallmentStatus } from "@/generated/prisma/enums";

export type InstallmentOption = {
  id: string;
  cycleNumber: number;
  label: string;
  status: InstallmentStatus;
};

export function RecordPaymentForm({
  loanId,
  installments,
  defaultInstallmentId,
  defaultDate,
  interestOnlyAmount,
  settlementAmount,
}: {
  loanId: string;
  installments: InstallmentOption[];
  defaultInstallmentId?: string;
  defaultDate: string;
  interestOnlyAmount: string;
  settlementAmount: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      loanId,
      installmentId: defaultInstallmentId ?? "",
      amount: "",
      paidAt: defaultDate,
      method: "CASH",
      reference: "",
      note: "",
    },
  });

  async function onSubmit(values: PaymentInput) {
    setFormError(null);
    const res = await recordPayment(values);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    reset({
      loanId,
      installmentId: defaultInstallmentId ?? "",
      amount: "",
      paidAt: defaultDate,
      method: "CASH",
      reference: "",
      note: "",
    });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input type="hidden" {...register("loanId")} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setValue("amount", interestOnlyAmount)}
        >
          Interest only
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setValue("amount", settlementAmount)}
        >
          Full settlement
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Amount (TZS)</Label>
          <Input {...register("amount")} inputMode="decimal" />
          {errors.amount ? (
            <p className="text-xs text-destructive">{errors.amount.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Payment date</Label>
          <Input {...register("paidAt")} type="date" />
          {errors.paidAt ? (
            <p className="text-xs text-destructive">{errors.paidAt.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Apply to cycle</Label>
          <Select {...register("installmentId")}>
            {(() => {
              // The earliest cycle whose previous cycle isn't yet rolled is the
              // only one selectable. Cycle 1 is always selectable until rolled.
              const sorted = [...installments].sort(
                (a, b) => a.cycleNumber - b.cycleNumber,
              );
              const firstUnrolled = sorted.find(
                (i) => i.status !== "INTEREST_PAID" && i.status !== "SETTLED",
              );
              const unlockedCycle = firstUnrolled?.cycleNumber ?? null;
              return sorted.map((i) => {
                const locked =
                  unlockedCycle !== null && i.cycleNumber > unlockedCycle;
                return (
                  <option
                    key={i.id}
                    value={i.id}
                    disabled={locked}
                  >
                    {i.label}
                    {locked ? "  (settle previous cycle first)" : ""}
                  </option>
                );
              });
            })()}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Method</Label>
          <Select {...register("method")}>
            {Object.values(PaymentMethod).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Reference</Label>
          <Input {...register("reference")} placeholder="Receipt / txn ref" />
        </div>
        <div className="space-y-1.5">
          <Label>Note</Label>
          <Input {...register("note")} />
        </div>
      </div>

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}
