import { bandMeta } from "@/lib/credit-score";
import type { CreditScore, Eligibility } from "@/lib/credit-score";

export function RiskMeter({
  credit,
  eligibility,
}: {
  credit: CreditScore;
  eligibility?: Eligibility;
}) {
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

      {eligibility?.status === "BLOCKED" ? (
        <div className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">
          <p className="font-medium">
            Not eligible for a new loan — admin override needed
          </p>
          <ul className="mt-0.5 list-disc pl-4">
            {eligibility.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : eligibility?.status === "WARNING" ? (
        <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Eligible, but check the record below before lending again.
        </p>
      ) : null}

      {credit.reasons.some((r) => r.delta < 0) ? (
        <p className="mt-3 text-xs font-medium text-slate-700">
          Why the score is down
        </p>
      ) : null}

      {credit.reasons.length > 0 ? (
        <ul className="mt-1.5 space-y-1 text-xs">
          {credit.reasons.map((r, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {r.label}
                {r.faded ? " · half weight (6+ months ago)" : ""}
              </span>
              <span
                className={
                  r.delta >= 0
                    ? "shrink-0 text-emerald-700"
                    : "shrink-0 text-red-700"
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
