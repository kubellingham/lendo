"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { updateLoan, deleteLoan } from "@/lib/actions/loan-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function LoanActions({
  loan,
  isAdmin,
  hasPayments,
}: {
  loan: { id: string; principal: string; disbursedAt: string };
  isAdmin: boolean;
  hasPayments: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    principal: loan.principal,
    disbursedAt: loan.disbursedAt,
  });

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateLoan({
        loanId: loan.id,
        principal: form.principal,
        disbursedAt: form.disbursedAt,
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
    const msg = hasPayments
      ? "This loan has recorded payments. Deleting it removes the loan AND all its payments permanently. Continue?"
      : "Delete this loan permanently?";
    if (!confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteLoan(loan.id);
      if (!res.ok) {
        alert(res.error);
      } else {
        router.push(res.redirectTo ?? "/loans");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>
      {isAdmin ? (
        <Button
          variant="outline"
          size="sm"
          onClick={remove}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit loan</DialogTitle>
          </DialogHeader>
          {hasPayments ? (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              This loan already has payments. Changing the principal or date
              recomputes the schedule and interest; existing payments are kept
              and re-applied.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Principal (TZS)</Label>
              <Input
                value={form.principal}
                onChange={(e) =>
                  setForm({ ...form, principal: e.target.value })
                }
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Disbursal date</Label>
              <Input
                type="date"
                value={form.disbursedAt}
                onChange={(e) =>
                  setForm({ ...form, disbursedAt: e.target.value })
                }
              />
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={pending}
            >
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
