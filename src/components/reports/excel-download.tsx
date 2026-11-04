"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// yyyy-MM for a month `back` months before the current one.
function monthKey(back = 0): string {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "This month", from: () => monthKey(0), to: () => monthKey(0) },
  { label: "Last month", from: () => monthKey(1), to: () => monthKey(1) },
  { label: "Last 3 months", from: () => monthKey(2), to: () => monthKey(0) },
  { label: "Last 6 months", from: () => monthKey(5), to: () => monthKey(0) },
  { label: "Last 12 months", from: () => monthKey(11), to: () => monthKey(0) },
  {
    label: "This year",
    from: () => `${new Date().getUTCFullYear()}-01`,
    to: () => monthKey(0),
  },
];

export function ExcelDownload() {
  const [from, setFrom] = useState(monthKey(1));
  const [to, setTo] = useState(monthKey(0));
  const valid = /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = from === p.from() && to === p.to();
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(p.from());
                setTo(p.to());
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From month</label>
          <Input
            type="month"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-44"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To month</label>
          <Input
            type="month"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-44"
          />
        </div>
        <Button asChild disabled={!valid}>
          <a
            href={valid ? `/api/reports/excel?from=${from}&to=${to}` : "#"}
            aria-disabled={!valid}
          >
            <FileSpreadsheet className="size-4" /> Download Excel
          </a>
        </Button>
      </div>
      {!valid ? (
        <p className="text-xs text-destructive">
          The &ldquo;From&rdquo; month must be the same as or before the &ldquo;To&rdquo; month.
        </p>
      ) : null}
    </div>
  );
}
