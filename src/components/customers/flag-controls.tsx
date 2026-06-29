"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCustomerFlag, clearCustomerFlag } from "@/lib/actions/customer-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FlagSeverity } from "@/generated/prisma/enums";

export function FlagControls({
  customerId,
  isFlagged,
}: {
  customerId: string;
  isFlagged: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<FlagSeverity>("MED");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitFlag() {
    setError(null);
    startTransition(async () => {
      const res = await addCustomerFlag({ customerId, reason, severity });
      if (!res.ok) setError(res.error);
      else {
        setReason("");
        router.refresh();
      }
    });
  }

  function clear() {
    startTransition(async () => {
      await clearCustomerFlag(customerId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="flag-reason">Reason</Label>
        <Input
          id="flag-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Missed multiple payments"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="flag-severity">Severity</Label>
        <Select
          id="flag-severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as FlagSeverity)}
        >
          {Object.values(FlagSeverity).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={submitFlag} disabled={pending || !reason.trim()}>
          Add flag
        </Button>
        {isFlagged ? (
          <Button variant="outline" onClick={clear} disabled={pending}>
            Clear active flag
          </Button>
        ) : null}
      </div>
    </div>
  );
}
