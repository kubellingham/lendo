import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { ReportData } from "@/lib/reporting";
import { bandMeta } from "@/lib/credit-score";

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.89, 0.91, 0.94);
const BRAND = rgb(0.02, 0.59, 0.41);
const DARK = rgb(0.06, 0.09, 0.16);
const GREEN = rgb(0.086, 0.639, 0.29);
const RED = rgb(0.86, 0.15, 0.15);
const SLATE = rgb(0.8, 0.84, 0.88);
const WHITE = rgb(1, 1, 1);

const W = 595.28;
const H = 841.89;
const M = 40;

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const tzs = (n: number | string) =>
  "TSh " +
  new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n)),
  );

type Ctx = { doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont; y: number };

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([W, H]);
  ctx.y = H - M;
}

function sectionTitle(ctx: Ctx, text: string) {
  if (ctx.y < 160) newPage(ctx);
  ctx.y -= 6;
  ctx.page.drawText(text, { x: M, y: ctx.y, size: 13, font: ctx.bold, color: INK });
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: M, y: ctx.y },
    end: { x: W - M, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 16;
}

function deltaLabel(cur: number, prev: number): { text: string; up: boolean } | null {
  if (prev === 0) {
    if (cur === 0) return null;
    return { text: "new", up: true };
  }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs prev`, up: pct >= 0 };
}

// A KPI tile. `goodUp` controls whether an increase is coloured green or red.
function kpiTile(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  delta: { text: string; up: boolean } | null,
  goodUp = true,
) {
  const h = 66;
  ctx.page.drawRectangle({
    x,
    y: y - h,
    width: w,
    height: h,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 1,
  });
  ctx.page.drawText(label, { x: x + 12, y: y - 18, size: 8.5, font: ctx.bold, color: MUTED });
  ctx.page.drawText(value, { x: x + 12, y: y - 40, size: 16, font: ctx.bold, color: INK });
  if (delta) {
    const good = delta.up === goodUp;
    ctx.page.drawText(delta.text, {
      x: x + 12,
      y: y - 56,
      size: 8,
      font: ctx.font,
      color: good ? GREEN : RED,
    });
  }
}

function groupedBars(
  ctx: Ctx,
  x: number,
  top: number,
  w: number,
  h: number,
  data: { label: string; disbursed: number; collected: number }[],
) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.disbursed, d.collected)));
  const baseY = top - h;
  // Y axis max label.
  ctx.page.drawText(tzs(max), { x, y: top - 4, size: 7, font: ctx.font, color: MUTED });
  ctx.page.drawLine({
    start: { x, y: baseY },
    end: { x: x + w, y: baseY },
    thickness: 1,
    color: LINE,
  });
  const groupW = w / data.length;
  const barW = Math.min(16, groupW / 3);
  data.forEach((d, i) => {
    const gx = x + i * groupW + groupW / 2;
    const dh = (d.disbursed / max) * (h - 14);
    const ch = (d.collected / max) * (h - 14);
    ctx.page.drawRectangle({
      x: gx - barW - 2,
      y: baseY,
      width: barW,
      height: dh,
      color: DARK,
    });
    ctx.page.drawRectangle({
      x: gx + 2,
      y: baseY,
      width: barW,
      height: ch,
      color: SLATE,
    });
    ctx.page.drawText(d.label, {
      x: gx - ctx.font.widthOfTextAtSize(d.label, 7) / 2,
      y: baseY - 10,
      size: 7,
      font: ctx.font,
      color: MUTED,
    });
  });
  // Legend.
  const ly = baseY - 24;
  ctx.page.drawRectangle({ x, y: ly, width: 9, height: 9, color: DARK });
  ctx.page.drawText("Disbursed", { x: x + 13, y: ly + 1, size: 8, font: ctx.font, color: MUTED });
  ctx.page.drawRectangle({ x: x + 80, y: ly, width: 9, height: 9, color: SLATE });
  ctx.page.drawText("Collected", { x: x + 93, y: ly + 1, size: 8, font: ctx.font, color: MUTED });
}

// 100% stacked horizontal bar with legend below.
function stackedBar(
  ctx: Ctx,
  x: number,
  top: number,
  w: number,
  segments: { label: string; value: number; color: ReturnType<typeof rgb> }[],
) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const barH = 18;
  let cx = x;
  for (const s of segments) {
    const sw = (s.value / total) * w;
    if (sw > 0) {
      ctx.page.drawRectangle({ x: cx, y: top - barH, width: sw, height: barH, color: s.color });
      cx += sw;
    }
  }
  // Legend rows.
  let ly = top - barH - 16;
  for (const s of segments) {
    ctx.page.drawRectangle({ x, y: ly, width: 9, height: 9, color: s.color });
    const pct = Math.round((s.value / total) * 100);
    ctx.page.drawText(`${s.label} — ${s.value} (${pct}%)`, {
      x: x + 14,
      y: ly + 1,
      size: 8.5,
      font: ctx.font,
      color: INK,
    });
    ly -= 14;
  }
  return top - barH - 16 - segments.length * 14;
}

function kvRow(ctx: Ctx, label: string, value: string, strong = false) {
  ctx.page.drawText(label, {
    x: M,
    y: ctx.y,
    size: strong ? 11 : 10,
    font: strong ? ctx.bold : ctx.font,
    color: strong ? INK : MUTED,
  });
  const vw = (strong ? ctx.bold : ctx.font).widthOfTextAtSize(value, strong ? 11 : 10);
  ctx.page.drawText(value, {
    x: W - M - vw,
    y: ctx.y,
    size: strong ? 11 : 10,
    font: strong ? ctx.bold : ctx.font,
    color: INK,
  });
  ctx.y -= strong ? 20 : 16;
}

export async function buildReportPdf(d: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Lendo Portfolio Report — ${d.label}`);
  doc.setAuthor("Lendo");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([W, H]);
  const ctx: Ctx = { doc, page, font, bold, y: H - M };

  // ---- Cover band ----
  page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: DARK });
  page.drawText("LENDO", { x: M, y: H - 52, size: 24, font: bold, color: WHITE });
  page.drawText("Portfolio Report", { x: M, y: H - 74, size: 12, font, color: rgb(0.7, 0.75, 0.78) });
  const per = d.label;
  page.drawText(per, {
    x: W - M - bold.widthOfTextAtSize(per, 18),
    y: H - 56,
    size: 18,
    font: bold,
    color: WHITE,
  });
  const gen = `Generated ${new Date().toISOString().slice(0, 10)}`;
  page.drawText(gen, {
    x: W - M - font.widthOfTextAtSize(gen, 8),
    y: H - 76,
    size: 8,
    font,
    color: rgb(0.7, 0.75, 0.78),
  });
  ctx.y = H - 110 - 26;

  // ---- Executive KPI tiles ----
  const c = d.current;
  const p = d.previous;
  const colW = (W - M * 2 - 12 * 3) / 4;
  const tiles: [string, string, { text: string; up: boolean } | null, boolean][] = [
    ["Disbursed", tzs(c.disbursed.toString()), deltaLabel(c.disbursed.toNumber(), p.disbursed.toNumber()), true],
    ["Collected", tzs(c.collected.toString()), deltaLabel(c.collected.toNumber(), p.collected.toNumber()), true],
    ["Interest income", tzs(c.interestIncome.toString()), deltaLabel(c.interestIncome.toNumber(), p.interestIncome.toNumber()), true],
    ["Outstanding (end)", tzs(c.outstanding.toString()), deltaLabel(c.outstanding.toNumber(), p.outstanding.toNumber()), true],
    ["New loans", String(c.newLoans), deltaLabel(c.newLoans, p.newLoans), true],
    ["New customers", String(c.newCustomers), deltaLabel(c.newCustomers, p.newCustomers), true],
    ["On-time rate", c.onTimeRatePct === null ? "—" : `${c.onTimeRatePct}%`, c.onTimeRatePct !== null && p.onTimeRatePct !== null ? deltaLabel(c.onTimeRatePct, p.onTimeRatePct) : null, true],
    ["Default rate (end)", c.defaultRatePct === null ? "—" : `${c.defaultRatePct}%`, c.defaultRatePct !== null && p.defaultRatePct !== null ? deltaLabel(c.defaultRatePct, p.defaultRatePct) : null, false],
  ];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const t = tiles[row * 4 + col];
      kpiTile(ctx, M + col * (colW + 12), ctx.y, colW, t[0], t[1], t[2], t[3]);
    }
    ctx.y -= 66 + 12;
  }

  // Narrative line.
  const collDelta = deltaLabel(c.collected.toNumber(), p.collected.toNumber());
  const narrative =
    `In ${d.label}, Lendo disbursed ${tzs(c.disbursed.toString())} and collected ${tzs(c.collected.toString())}` +
    (collDelta ? ` (${collDelta.text.replace(" vs prev", ` vs ${d.prevLabel}`)})` : "") +
    `, of which ${tzs(c.interestIncome.toString())} was interest income.`;
  ctx.y -= 2;
  wrapText(ctx, narrative, M, W - M * 2, 9.5);
  ctx.y -= 8;

  // ---- Trends ----
  sectionTitle(ctx, "Disbursed vs collected — last 6 months");
  groupedBars(ctx, M, ctx.y, W - M * 2, 130, d.trend);
  ctx.y -= 130 + 48;

  // ---- Aging & risk ----
  sectionTitle(ctx, "Portfolio health");
  const agingColors = [GREEN, hexToRgb("#65a30d"), hexToRgb("#d97706"), hexToRgb("#ea580c"), RED];
  page.drawText("Aging of outstanding principal", {
    x: M,
    y: ctx.y,
    size: 9.5,
    font: bold,
    color: INK,
  });
  ctx.y -= 12;
  const afterAging = stackedBar(
    ctx,
    M,
    ctx.y,
    W - M * 2,
    d.aging.map((a, i) => ({ label: a.label, value: a.count, color: agingColors[i] ?? SLATE })),
  );
  ctx.y = afterAging - 14;

  page.drawText("Risk-score distribution (current)", {
    x: M,
    y: ctx.y,
    size: 9.5,
    font: bold,
    color: INK,
  });
  ctx.y -= 12;
  const afterRisk = stackedBar(
    ctx,
    M,
    ctx.y,
    W - M * 2,
    d.risk.map((r) => ({
      label: bandMeta(r.band).label,
      value: r.count,
      color: hexToRgb(bandMeta(r.band).color),
    })),
  );
  ctx.y = afterRisk - 10;

  // ---- Cash pool & tithes ----
  if (ctx.y < 230) newPage(ctx);
  sectionTitle(ctx, "Cash pool & tithes");
  kvRow(ctx, "Money in (capital raised + collected)", tzs(d.cashPool.periodIn.toString()));
  kvRow(ctx, "  · Capital raised", tzs(d.cashPool.capitalRaised.toString()));
  kvRow(ctx, "  · Collected from customers", tzs(c.collected.toString()));
  kvRow(ctx, "Money out (disbursed + capital repaid + tithes)", tzs(d.cashPool.periodOut.toString()));
  kvRow(ctx, "  · Disbursed to customers", tzs(d.cashPool.disbursed.toString()));
  kvRow(ctx, "  · Capital repaid", tzs(d.cashPool.capitalRepaid.toString()));
  kvRow(ctx, `Interest earned (tithe base)`, tzs(d.tithes.interest.toString()));
  kvRow(ctx, `Tithe (${d.tithes.ratePct}% of interest)`, tzs(d.tithes.tithe.toString()));
  ctx.y -= 4;
  kvRow(ctx, "Cash on hand (cumulative, at period end)", tzs(d.cashPool.cashOnHand.toString()), true);

  // Footer on all pages.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText("Lendo · Confidential — internal management report", {
      x: M,
      y: 24,
      size: 7.5,
      font,
      color: MUTED,
    });
    const lbl = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(lbl, {
      x: W - M - font.widthOfTextAtSize(lbl, 7.5),
      y: 24,
      size: 7.5,
      font,
      color: MUTED,
    });
  });

  return doc.save();
}

function wrapText(ctx: Ctx, text: string, x: number, maxW: number, size: number) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(test, size) > maxW) {
      ctx.page.drawText(line, { x, y: ctx.y, size, font: ctx.font, color: MUTED });
      ctx.y -= size + 4;
      line = w;
    } else line = test;
  }
  if (line) {
    ctx.page.drawText(line, { x, y: ctx.y, size, font: ctx.font, color: MUTED });
    ctx.y -= size + 4;
  }
}
