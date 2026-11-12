import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, ensureLoanCycles, recomputeAllRisk, flags } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  ensureLoanCycles: vi.fn(async () => {}),
  recomputeAllRisk: vi.fn(async () => 0),
  flags: { failNext: false },
}));

vi.mock("@/lib/db", () => ({
  db: { loan: { findMany: vi.fn(async () => [{ id: "l1" }, { id: "l2" }]) } },
}));
vi.mock("@/lib/settings", () => ({
  getSetting: async (k: string) => store.get(k) ?? "",
  setSetting: async (k: string, v: string) => void store.set(k, v),
}));
vi.mock("@/lib/loan-maintenance", () => ({ ensureLoanCycles }));
vi.mock("@/lib/customer-risk", () => ({
  recomputeAllRisk: async () => {
    if (flags.failNext) {
      flags.failNext = false;
      throw new Error("db down");
    }
    return recomputeAllRisk();
  },
}));

import { ensureDailyRefresh, resetDailyRefreshMemo, DAILY_REFRESH_KEY } from "@/lib/daily-refresh";

describe("ensureDailyRefresh", () => {
  beforeEach(() => {
    store.clear();
    resetDailyRefreshMemo();
    ensureLoanCycles.mockClear();
    recomputeAllRisk.mockClear();
  });

  it("refreshes every open loan and every score once per Tanzania day", async () => {
    const morning = new Date("2026-11-12T05:00:00Z");
    await ensureDailyRefresh(morning);
    await ensureDailyRefresh(new Date("2026-11-12T18:00:00Z")); // 21:00 same day
    expect(ensureLoanCycles).toHaveBeenCalledTimes(2); // two open loans, once
    expect(recomputeAllRisk).toHaveBeenCalledTimes(1);
    expect(store.get(DAILY_REFRESH_KEY)).toBe("2026-11-12");
  });

  it("runs again after Tanzania midnight (21:00 UTC)", async () => {
    await ensureDailyRefresh(new Date("2026-11-12T20:59:00Z"));
    await ensureDailyRefresh(new Date("2026-11-12T21:00:00Z")); // 00:00 on the 13th in Dar
    expect(recomputeAllRisk).toHaveBeenCalledTimes(2);
    expect(store.get(DAILY_REFRESH_KEY)).toBe("2026-11-13");
  });

  it("another server instance doesn't redo it the same day", async () => {
    store.set(DAILY_REFRESH_KEY, "2026-11-12");
    await ensureDailyRefresh(new Date("2026-11-12T09:00:00Z"));
    expect(recomputeAllRisk).not.toHaveBeenCalled();
  });

  it("a failure is retried on the next request and never breaks the page", async () => {
    flags.failNext = true;
    await expect(ensureDailyRefresh(new Date("2026-11-12T09:00:00Z"))).resolves.toBeUndefined();
    expect(store.get(DAILY_REFRESH_KEY)).toBeUndefined();
    await ensureDailyRefresh(new Date("2026-11-12T09:01:00Z"));
    expect(recomputeAllRisk).toHaveBeenCalledTimes(1);
    expect(store.get(DAILY_REFRESH_KEY)).toBe("2026-11-12");
  });
});
