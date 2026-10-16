import type { Role } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/rbac";
import { formatTZS, type MoneyInput } from "@/lib/money";

// ---------------------------------------------------------------------------
// Demo mode — a role that lets prospective clients explore the UI without
// seeing real amounts, phone numbers, or sensitive business pages.
// ---------------------------------------------------------------------------

export function isDemo(user: Pick<SessionUser, "role"> | { role: Role } | null): boolean {
  return !!user && user.role === "DEMO_VIEWER";
}

/** Pages a DEMO_VIEWER should not reach at all. */
const DEMO_BLOCKED_PATHS = new Set([
  "/capital",
  "/tithes",
  "/reports",
  "/settings",
  "/settings/staff",
  "/settings/profile",
  "/referrals",
]);
export function demoBlocks(path: string): boolean {
  for (const p of DEMO_BLOCKED_PATHS) {
    if (path === p || path.startsWith(p + "/")) return true;
  }
  return false;
}

// Masked placeholders — real numbers never leak into the demo viewer's screen.
const MASK_MONEY = "TSh ••••••";
const MASK_PHONE = "+••• ••• ••• •••";
const MASK_ID = "••••-••••-••";
const MASK_ACCOUNT = "•••• •••• ••••";

/** Format money. For a demo viewer, returns a masked placeholder. */
export function fmtMoney(amount: MoneyInput, demo: boolean): string {
  return demo ? MASK_MONEY : formatTZS(amount);
}

/** Mask a phone number but keep its shape so the UI looks real. */
export function fmtPhone(phone: string | null | undefined, demo: boolean): string {
  if (!phone) return "—";
  if (!demo) return phone;
  // Keep the leading +, mask the digits.
  const kept = phone.startsWith("+") ? "+" : "";
  return kept + MASK_PHONE.slice(1); // drop the "+" from MASK_PHONE if any
}

export function fmtId(id: string | null | undefined, demo: boolean): string {
  if (!id) return "—";
  return demo ? MASK_ID : id;
}

export function fmtAccount(acc: string | null | undefined, demo: boolean): string {
  if (!acc) return "—";
  return demo ? MASK_ACCOUNT : acc;
}

export const DEMO_MASKS = {
  money: MASK_MONEY,
  phone: MASK_PHONE,
  id: MASK_ID,
  account: MASK_ACCOUNT,
};
