import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Branding } from "@/lib/settings";

// Shared branding for Lendo's PDFs: the logo tile in the header band and the
// contact lines in the footer.

export const DEFAULT_BRANDING: Branding = {
  name: "Lendo",
  tagline: "Borrow with confidence. Repay with ease.",
  phone: "+255 786 776 677",
  email: "ikube77@gmail.com",
  town: "Dodoma, Tanzania",
  logo: "",
};

/** Embed the logo once per document (null if none or unreadable). */
export async function embedLogo(doc: PDFDocument, b: Branding): Promise<PDFImage | null> {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(b.logo ?? "");
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], "base64");
    return m[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (err) {
    console.error("[pdf] logo could not be embedded", err);
    return null;
  }
}

/**
 * Draw the logo on a white rounded tile (so any logo shows on the dark band).
 * Returns the width used, so the name can sit to the right of it.
 */
export function drawLogoTile(
  page: PDFPage,
  logo: PDFImage,
  x: number,
  centerY: number,
  tileH: number,
): number {
  const pad = 6;
  const maxImgH = tileH - pad * 2;
  const maxImgW = maxImgH * 2.6; // allow wide logos
  const scale = Math.min(maxImgW / logo.width, maxImgH / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  const tileW = w + pad * 2;
  page.drawRectangle({
    x,
    y: centerY - tileH / 2,
    width: tileW,
    height: tileH,
    color: rgb(1, 1, 1),
    borderColor: rgb(1, 1, 1),
    borderWidth: 0,
  });
  page.drawImage(logo, { x: x + pad, y: centerY - h / 2, width: w, height: h });
  return tileW;
}

/** "Lendo · Dodoma, Tanzania" */
export function nameLine(b: Branding): string {
  return [b.name, b.town].filter(Boolean).join("  ·  ");
}

/** "+255 786 776 677 · ikube77@gmail.com" */
export function contactLine(b: Branding): string {
  return [b.phone, b.email].filter(Boolean).join("  ·  ");
}

/** Keep text within a width, adding "…" if needed (standard fonts only). */
export function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Split text into at most `maxLines` lines that fit `maxW` (last line trimmed with …). */
export function wrap(font: PDFFont, text: string, size: number, maxW: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(font, lines.slice(maxLines - 1).join(" "), size, maxW);
    return kept;
  }
  return lines.map((l) => fit(font, l, size, maxW));
}
