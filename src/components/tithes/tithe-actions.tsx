"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitTithe, unsubmitTithe } from "@/lib/actions/tithe-actions";

export function TitheRowActions({
  period,
  submitted,
  canSubmit,
}: {
  period: string;
  submitted: boolean;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!canSubmit) {
    return submitted ? (
      <span className="text-xs text-emerald-700">Submitted</span>
    ) : (
      <span className="text-xs text-muted-foreground">Pending</span>
    );
  }

  function mark() {
    start(async () => {
      const res = await submitTithe(period);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  function undo() {
    if (!confirm("Mark this month as not yet submitted?")) return;
    start(async () => {
      const res = await unsubmitTithe(period);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  return submitted ? (
    <Button variant="ghost" size="sm" onClick={undo} disabled={pending}>
      <Undo2 className="size-4" /> Undo
    </Button>
  ) : (
    <Button size="sm" onClick={mark} disabled={pending}>
      <Check className="size-4" /> Mark submitted
    </Button>
  );
}
