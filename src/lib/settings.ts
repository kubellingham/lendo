import { db } from "@/lib/db";

export const SETTING_KEYS = {
  titheRatePct: "tithe_rate_pct",
} as const;

const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.titheRatePct]: "10",
};

/** Read a raw setting value, falling back to a known default. */
export async function getSetting(key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? "";
}

/** Tithe rate as a whole-number percent (0–100), clamped, default 10. */
export async function getTitheRatePct(): Promise<number> {
  const raw = await getSetting(SETTING_KEYS.titheRatePct);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 10;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
