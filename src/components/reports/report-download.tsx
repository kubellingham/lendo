"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ReportDownload() {
  const now = new Date();
  const [type, setType] = useState<"month" | "quarter" | "year">("month");
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(now.getUTCMonth() / 3) + 1);

  const years = Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - i);

  function href() {
    const p = new URLSearchParams({ type, year: String(year) });
    if (type === "month") p.set("month", String(month));
    if (type === "quarter") p.set("quarter", String(quarter));
    return `/api/reports/pdf?${p.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Report</label>
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="h-9"
        >
          <option value="month">Monthly</option>
          <option value="quarter">Quarterly</option>
          <option value="year">Annual</option>
        </Select>
      </div>

      {type === "month" ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Month</label>
          <Select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="h-9"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {type === "quarter" ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Quarter</label>
          <Select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="h-9"
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Year</label>
        <Select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-9"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      <Button asChild>
        <a href={href()} target="_blank" rel="noopener noreferrer">
          <FileDown className="size-4" /> Download report PDF
        </a>
      </Button>
    </div>
  );
}
