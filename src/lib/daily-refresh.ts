import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { APP_TIMEZONE } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/settings";
import { ensureLoanCycles } from "@/lib/loan-maintenance";
import { recomputeAllRisk } from "@/lib/customer-risk";

// ---------------------------------------------------------------------------
// Once a day (Tanzania calendar day), bring saved values up to date with the
// passing of time — not only when someone records a payment:
//   • every open loan: extra rounds past day 90, round + loan statuses
//     (overdue / defaulted), reducing-balance interest
//   • every customer: Lendo Score, risk band, worst days late, auto-blacklist
// Without this, a borrower who simply stops paying keeps a perfect score in
// the customer list, reports, dashboard and Lendo AI until someone happens to
// open their page.
//
// The first request of the day pays for it; after that it's a no-op (one
// memory check per server instance, one settings read on a cold start).
// ---------------------------------------------------------------------------

export const DAILY_REFRESH_KEY = "daily_refresh_day";

let doneDay: string | null = null;
let running: Promise<void> | null = null;

/** Run the daily refresh if it hasn't run today. Never throws. */
export async function ensureDailyRefresh(now: Date = new Date()): Promise<void> {
  const today = formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd");
  if (doneDay === today) return;
  if (running) return running;
  running = (async () => {
    try {
      if ((await getSetting(DAILY_REFRESH_KEY)) !== today) {
        const open = await db.loan.findMany({
          where: { status: { in: ["ACTIVE", "OVERDUE", "DEFAULTED"] } },
          select: { id: true },
        });
        for (const l of open) await ensureLoanCycles(l.id);
        await recomputeAllRisk();
        // Marked done only after it worked, so a failure is retried next request.
        await setSetting(DAILY_REFRESH_KEY, today);
      }
      doneDay = today;
    } catch (err) {
      console.error("[dailyRefresh]", err);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** For tests. */
export function resetDailyRefreshMemo() {
  doneDay = null;
  running = null;
}
