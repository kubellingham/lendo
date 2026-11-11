import { db } from "@/lib/db";

export const SETTING_KEYS = {
  titheRatePct: "tithe_rate_pct",
  paymentBank: "payment_bank",
  paymentAccountName: "payment_account_name",
  paymentAccountNumber: "payment_account_number",
  brandName: "brand_name",
  brandTagline: "brand_tagline",
  brandPhone: "brand_phone",
  brandEmail: "brand_email",
  brandTown: "brand_town",
  /** Logo as a small PNG/JPEG data URL ("" = no logo). */
  brandLogo: "brand_logo",
} as const;

const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.titheRatePct]: "10",
  [SETTING_KEYS.paymentBank]: "CRDB BANK",
  [SETTING_KEYS.paymentAccountName]: "Kathleen Kube",
  [SETTING_KEYS.paymentAccountNumber]: "10327855568",
  [SETTING_KEYS.brandName]: "Lendo",
  [SETTING_KEYS.brandTagline]: "Borrow with confidence. Repay with ease.",
  [SETTING_KEYS.brandPhone]: "+255 786 776 677",
  [SETTING_KEYS.brandEmail]: "ikube77@gmail.com",
  [SETTING_KEYS.brandTown]: "Dodoma, Tanzania",
  [SETTING_KEYS.brandLogo]: "",
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

/** Bank / account details customers should pay into. */
export async function getPaymentDetails(): Promise<{
  bank: string;
  accountName: string;
  accountNumber: string;
}> {
  const [bank, accountName, accountNumber] = await Promise.all([
    getSetting(SETTING_KEYS.paymentBank),
    getSetting(SETTING_KEYS.paymentAccountName),
    getSetting(SETTING_KEYS.paymentAccountNumber),
  ]);
  return { bank, accountName, accountNumber };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export type Branding = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  town: string;
  /** PNG/JPEG data URL, or "" for no logo. */
  logo: string;
};

/** Business name, contacts and logo printed on Lendo's PDFs. */
export async function getBranding(): Promise<Branding> {
  const k = SETTING_KEYS;
  const [name, tagline, phone, email, town, logo] = await Promise.all([
    getSetting(k.brandName),
    getSetting(k.brandTagline),
    getSetting(k.brandPhone),
    getSetting(k.brandEmail),
    getSetting(k.brandTown),
    getSetting(k.brandLogo),
  ]);
  return { name: name || "Lendo", tagline, phone, email, town, logo };
}
