"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wallet, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createCapitalSource,
  recordCapitalRepayment,
  deleteCapitalSource,
} from "@/lib/actions/capital-actions";

const TYPES = [
  { value: "BORROWED", label: "Borrowed (we owe it back)" },
  { value: "INVESTMENT", label: "Investment" },
  { value: "OWN_FUNDS", label: "Own funds" },
  { value: "OTHER", label: "Other" },
];
const METHODS = ["CASH", "MPESA", "BANK", "OTHER"];

const today = () => new Date().toISOString().slice(0, 10);

export function AddCapitalButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    sourceName: "",
    type: "BORROWED",
    amount: "",
    interestRatePct: "",
    rateNote: "",
    receivedAt: today(),
    dueAt: "",
    notes: "",
  });

  function submit() {
    setError(null);
    start(async () => {
      const res = await createCapitalSource({
        ...form,
        type: form.type as "BORROWED" | "INVESTMENT" | "OWN_FUNDS" | "OTHER",
      });
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        setForm({
          sourceName: "",
          type: "BORROWED",
          amount: "",
          interestRatePct: "",
          rateNote: "",
          receivedAt: today(),
          dueAt: "",
          notes: "",
        });
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Record capital
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record capital received</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Source (who it came from)</Label>
              <Input
                value={form.sourceName}
                onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
                placeholder="e.g. Aunt Neema / CRDB overdraft"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (TZS)</Label>
              <Input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                inputMode="decimal"
                placeholder="2000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Interest rate % (optional)</Label>
              <Input
                value={form.interestRatePct}
                onChange={(e) =>
                  setForm({ ...form, interestRatePct: e.target.value })
                }
                inputMode="decimal"
                placeholder="e.g. 5"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rate note (optional)</Label>
              <Input
                value={form.rateNote}
                onChange={(e) => setForm({ ...form, rateNote: e.target.value })}
                placeholder="per month / flat / one-off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Received on</Label>
              <Input
                type="date"
                value={form.receivedAt}
                onChange={(e) => setForm({ ...form, receivedAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due date (optional)</Label>
              <Input
                type="date"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CapitalRowActions({
  sourceId,
  sourceName,
  isAdmin,
}: {
  sourceId: string;
  sourceName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    amount: "",
    paidAt: today(),
    method: "CASH",
    note: "",
  });

  function submit() {
    setError(null);
    start(async () => {
      const res = await recordCapitalRepayment({
        capitalSourceId: sourceId,
        amount: form.amount,
        paidAt: form.paidAt,
        method: form.method as "CASH" | "MPESA" | "BANK" | "OTHER",
        note: form.note,
      });
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        setForm({ amount: "", paidAt: today(), method: "CASH", note: "" });
        router.refresh();
      }
    });
  }

  function remove() {
    if (!confirm(`Delete "${sourceName}" and its repayments?`)) return;
    start(async () => {
      const res = await deleteCapitalSource(sourceId);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Wallet className="size-4" /> Repay
      </Button>
      {isAdmin ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={pending}
          title="Delete"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record repayment · {sourceName}</DialogTitle>
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
              <Label>Paid on</Label>
              <Input
                type="date"
                value={form.paidAt}
                onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
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
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Record repayment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
