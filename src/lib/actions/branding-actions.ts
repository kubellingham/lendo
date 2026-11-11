"use server";

import { revalidatePath } from "next/cache";
import { PDFDocument } from "pdf-lib";
import { requireRole, ForbiddenError } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { setSetting, SETTING_KEYS } from "@/lib/settings";

const MAX_CHARS = 700_000; // ~500 KB image
const LOGO = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

export type LogoResult = { ok: true } | { ok: false; error: string };

/** Save (or with "" remove) the logo printed on PDFs. Admins only. */
export async function saveLogo(dataUrl: string): Promise<LogoResult> {
  let admin;
  try {
    admin = await requireRole("ADMIN");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  if (dataUrl) {
    const m = LOGO.exec(dataUrl);
    if (!m) return { ok: false, error: "Please choose a PNG or JPG image." };
    if (dataUrl.length > MAX_CHARS) return { ok: false, error: "That logo is too large. Try a smaller image." };
    // Make sure it can actually be drawn in a PDF.
    try {
      const doc = await PDFDocument.create();
      const bytes = Buffer.from(m[2], "base64");
      if (m[1] === "png") await doc.embedPng(bytes);
      else await doc.embedJpg(bytes);
    } catch {
      return { ok: false, error: "That image couldn't be read. Try saving it as PNG and upload again." };
    }
  }

  await setSetting(SETTING_KEYS.brandLogo, dataUrl);
  await audit({
    actorId: admin.id,
    action: "settings.update",
    entity: "Setting",
    entityId: SETTING_KEYS.brandLogo,
    after: { logo: dataUrl ? `image (${Math.round((dataUrl.length * 3) / 4 / 1024)} KB)` : "removed" },
  });
  revalidatePath("/settings");
  return { ok: true };
}
