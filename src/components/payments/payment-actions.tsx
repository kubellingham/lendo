"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { updatePayment, deletePayment } from "@/lib/actions/payment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PaymentMethod } from "@/generated/prisma/enums";

export type EditablePayment = {
  id: string;
  loanId: string;
  amount: string;
  paidAt: string;
  method: keyof typeof PaymentMethod;
  reference: string | null;
  note: string | null;
  installmentId: string | null;
};

export function PaymentActions({
  payment,
  installments,
  isAdmin,
}: {
  payment: EditablePayment;
  installments: { id: string; cycleNumber: number; label: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    amount: payment.amount,
    paidAt: payment.paidAt,
    method: payment.method,
    reference: payment.reference ?? "",
    note: payment.note ?? "",
    installmentId: payment.installmentId ?? "",
  });

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updatePayment({
        paymentId: payment.id,
        amount: form.amount,
        paidAt: form.paidAt,
        method: form.method,
        reference: form.reference,
        note: form.note,
        installmentId: form.installmentId || null,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        setEditOpen(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!confirm("Delete this payment? This will recompute loan status.")) return;
    startTransition(async () => {
      const res = await deletePayment(payment.id);
      if (!res.ok) {
        alert(res.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setEditOpen(true)}
        title="Edit payment"
      >
        <Pencil className="size-4" />
      </Button>
      {isAdmin ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={remove}
          title="Delete payment"
          disabled={pending}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Amount (TZS)</Label>
              <Input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment date</Label>
              <Input
                type="date"
                value={form.paidAt}
                onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cycle</Label>
              <Select
                value={form.installmentId}
                onChange={(e) =>
                  setForm({ ...form, installmentId: e.target.value })
                }
              >
                <option value="">— unallocated —</option>
                {installments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={form.method}
                onChange={(e) =>
                  setForm({
                    ...form,
                    method: e.target.value as keyof typeof PaymentMethod,
                  })
                }
              >
                {Object.values(PaymentMethod).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Reference</Label>
              <Input
                value={form.reference}
                onChange={(e) =>
                  setForm({ ...form, reference: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Note</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
