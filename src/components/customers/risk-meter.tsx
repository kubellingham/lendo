import { bandMeta } from "@/lib/credit-score";
import type { CreditScore } from "@/lib/credit-score";

export function RiskMeter({ credit }: { credit: CreditScore }) {
  const meta = bandMeta(credit.band);
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-muted-foreground">Lendo Score</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      <div className="mt-1 flex items-end gap-2">
        <span
          className="stat-value text-3xl font-semibold"
          style={{ color: meta.color }}
        >
          {credit.score}
        </span>
        <span className="pb-1 text-xs text-muted-foreground">/ 100</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${credit.score}%`, backgroundColor: meta.color }}
        />
      </div>

      {credit.autoBlacklisted ? (
        <p className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">
          Auto-blacklisted (90+ days late / defaulted) — new loans require an
          admin override.
        </p>
      ) : null}

      {credit.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {credit.reasons.map((r, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{r.label}</span>
              <span
                className={
                  r.delta >= 0 ? "text-emerald-700" : "text-red-700"
                }
              >
                {r.delta > 0 ? `+${r.delta}` : r.delta}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Clean record — no deductions.
        </p>
      )}
    </div>
  );
}

/** Compact chip for lists. */
export function RiskChip({
  score,
  band,
}: {
  score: number;
  band: CreditScore["band"];
}) {
  const meta = bandMeta(band);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
      title={meta.label}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {score}
    </span>
  );
}
