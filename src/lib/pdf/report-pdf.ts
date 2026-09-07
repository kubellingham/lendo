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

type Col = { label: string; width: number; right?: boolean };

function fitText(font: PDFFont, text: string, width: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= width - 8) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > width - 8) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function drawTable(ctx: Ctx, title: string, columns: Col[], rows: string[][]) {
  sectionTitle(ctx, title);
  const totalW = columns.reduce((a, c) => a + c.width, 0);

  const header = () => {
    ctx.page.drawRectangle({
      x: M,
      y: ctx.y - 5,
      width: totalW,
      height: 18,
      color: rgb(0.96, 0.97, 0.98),
    });
    let cx = M;
    for (const c of columns) {
      const w = ctx.bold.widthOfTextAtSize(c.label, 8);
      const tx = c.right ? cx + c.width - 6 - w : cx + 6;
      ctx.page.drawText(c.label, { x: tx, y: ctx.y, size: 8, font: ctx.bold, color: MUTED });
      cx += c.width;
    }
    ctx.y -= 22;
  };

  header();
  if (rows.length === 0) {
    ctx.page.drawText("None in this period.", {
      x: M + 6,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: MUTED,
    });
    ctx.y -= 18;
    return;
  }
  for (const row of rows) {
    if (ctx.y < 56) {
      newPage(ctx);
      ctx.y -= 4;
      header();
    }
    let cx = M;
    row.forEach((cell, i) => {
      const c = columns[i];
      const size = 8.5;
      const text = fitText(ctx.font, cell ?? "", c.width, size);
      const tx = c.right ? cx + c.width - 6 - ctx.font.widthOfTextAtSize(text, size) : cx + 6;
      ctx.page.drawText(text, { x: tx, y: ctx.y, size, font: ctx.font, color: INK });
      cx += c.width;
    });
    ctx.y -= 6;
    ctx.page.drawLine({
      start: { x: M, y: ctx.y },
      end: { x: M + totalW, y: ctx.y },
      thickness: 0.4,
      color: LINE,
    });
    ctx.y -= 12;
  }
  ctx.y -= 10;
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

  // -------------------------------------------------------------------
  // Part B — detailed breakdown (flat tables).
  // -------------------------------------------------------------------
  const dt = d.detail;
  newPage(ctx);
  ctx.page.drawText(`Detailed breakdown — ${d.label}`, {
    x: M,
    y: ctx.y,
    size: 15,
    font: bold,
    color: INK,
  });
  ctx.y -= 26;

  // How they paid.
  drawTable(
    ctx,
    "How they paid — by method",
    [
      { label: "Method", width: 220 },
      { label: "Payments", width: 130, right: true },
      { label: "Amount", width: 165, right: true },
    ],
    dt.methodBreakdown.map((m) => [m.method, String(m.count), tzs(m.amount.toString())]),
  );

  drawTable(
    ctx,
    "Payments log",
    [
      { label: "Date", width: 70 },
      { label: "Customer", width: 120 },
      { label: "Loan", width: 70 },
      { label: "Amount", width: 75, right: true },
      { label: "Method", width: 55 },
      { label: "Timing", width: 60 },
      { label: "By", width: 65 },
    ],
    dt.paymentsLog.map((p) => [
      p.date,
      p.customer,
      p.loanRef,
      tzs(p.amount.toString()),
      p.method,
      p.timing,
      p.recordedBy,
    ]),
  );

  // Loan register.
  drawTable(
    ctx,
    "Loan register (active in period)",
    [
      { label: "Loan", width: 62 },
      { label: "Customer", width: 100 },
      { label: "Principal", width: 68, right: true },
      { label: "Disbursed", width: 62 },
      { label: "Due", width: 62 },
      { label: "Status", width: 46 },
      { label: "Outstanding", width: 68, right: true },
      { label: "Late", width: 34, right: true },
    ],
    dt.loanRegister.map((l) => [
      l.ref,
      l.customer,
      tzs(l.principal.toString()),
      l.disbursed,
      l.due,
      l.status,
      tzs(l.outstanding.toString()),
      l.daysLate > 0 ? `${l.daysLate}d` : "—",
    ]),
  );

  drawTable(
    ctx,
    "New loans issued in period",
    [
      { label: "Loan", width: 70 },
      { label: "Customer", width: 165 },
      { label: "Principal", width: 100, right: true },
      { label: "Disbursed", width: 90 },
      { label: "Due", width: 90 },
    ],
    dt.newLoans.map((l) => [
      l.ref,
      l.customer,
      tzs(l.principal.toString()),
      l.disbursed,
      l.due,
    ]),
  );

  // Customer roster.
  drawTable(
    ctx,
    "Customer roster (active in period)",
    [
      { label: "Customer", width: 105 },
      { label: "Phone", width: 95 },
      { label: "Score", width: 42, right: true },
      { label: "Band", width: 62 },
      { label: "Loans", width: 40, right: true },
      { label: "Borrowed", width: 78, right: true },
      { label: "Outstanding", width: 78, right: true },
    ],
    dt.roster.map((r) => [
      r.name,
      r.phone,
      String(r.riskScore),
      bandMeta(r.riskBand).label,
      String(r.loanCount),
      tzs(r.borrowed.toString()),
      tzs(r.outstanding.toString()),
    ]),
  );

  // Watchlist.
  drawTable(
    ctx,
    "Watchlist — overdue / defaulted",
    [
      { label: "Loan", width: 60 },
      { label: "Customer", width: 95 },
      { label: "Phone", width: 88 },
      { label: "Days late", width: 52, right: true },
      { label: "Owed", width: 72, right: true },
      { label: "Referral", width: 148 },
    ],
    dt.watchlist.map((w) => [
      w.ref,
      w.customer,
      w.phone,
      `${w.daysLate}d`,
      tzs(w.outstanding.toString()),
      w.referral,
    ]),
  );

  // Collections breakdown.
  drawTable(
    ctx,
    "Collections — interest vs principal (period)",
    [
      { label: "Loan", width: 62 },
      { label: "Customer", width: 133 },
      { label: "Interest", width: 90, right: true },
      { label: "Principal", width: 90, right: true },
      { label: "Total", width: 90, right: true },
    ],
    dt.collections.map((r) => [
      r.ref,
      r.customer,
      tzs(r.interest.toString()),
      tzs(r.principal.toString()),
      tzs(r.total.toString()),
    ]),
  );

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
