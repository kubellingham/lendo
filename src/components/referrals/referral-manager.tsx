"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveReferral } from "@/lib/actions/referral-actions";

type Referral = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  notes: string | null;
};

function ReferralDialog({
  referral,
  trigger,
}: {
  referral?: Referral;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: referral?.name ?? "",
    phone: referral?.phone ?? "",
    relationship: referral?.relationship ?? "",
    notes: referral?.notes ?? "",
  });

  function submit() {
    setError(null);
    start(async () => {
      const res = await saveReferral({ id: referral?.id, ...form });
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {referral ? "Edit referral" : "New referral"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Violet Mushi"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+255…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <Input
                value={form.relationship}
                onChange={(e) =>
                  setForm({ ...form, relationship: e.target.value })
                }
                placeholder="Aunt, employer…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Input
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

export function AddReferralButton() {
  return (
    <ReferralDialog
      trigger={
        <Button size="sm">
          <Plus className="size-4" /> New referral
        </Button>
      }
    />
  );
}

export function EditReferralButton({ referral }: { referral: Referral }) {
  return (
    <ReferralDialog
      referral={referral}
      trigger={
        <Button variant="ghost" size="sm">
          <Pencil className="size-4" /> Edit
        </Button>
      }
    />
  );
}
