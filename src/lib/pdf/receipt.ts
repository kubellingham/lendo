import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

// Brand palette (kept in sync with the app's slate/emerald look).
const INK = rgb(0.06, 0.09, 0.16); // slate-900
const MUTED = rgb(0.42, 0.45, 0.5); // slate-500
const LINE = rgb(0.89, 0.91, 0.94); // slate-200
const BRAND = rgb(0.02, 0.59, 0.41); // emerald-600
const BRAND_DARK = rgb(0.06, 0.09, 0.16);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;

export type ReceiptRow = { label: string; value: string; strong?: boolean };

export type ReceiptDoc = {
  docTitle: string; // "PAYMENT RECEIPT" | "LOAN STATEMENT"
  reference: string; // LND-XXXXXX
  issuedOn: string; // formatted date-time
  customerName: string;
  customerPhone: string;
  // Key/value summary block.
  summary: ReceiptRow[];
  // Optional line-item table (schedule / payments).
  table?: {
    title: string;
    columns: string[];
    // Right-aligned flags per column index.
    rightAlign?: number[];
    rows: string[][];
  };
  // Highlighted total shown in a coloured box.
  highlight?: { label: string; value: string };
  footerNote?: string;
  tagline: string;
};

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
};

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 60) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN;
  }
}

function drawHeader(ctx: Ctx, docTitle: string) {
  const { page, bold, font } = ctx;
  // Brand band.
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 96,
    width: PAGE_W,
    height: 96,
    color: BRAND_DARK,
  });
  page.drawText("LENDO", {
    x: MARGIN,
    y: PAGE_H - 56,
    size: 26,
    font: bold,
    color: WHITE,
  });
  page.drawText("Borrow with confidence. Repay with ease.", {
    x: MARGIN,
    y: PAGE_H - 74,
    size: 9,
    font,
    color: rgb(0.7, 0.75, 0.78),
  });
  // Document title (right aligned).
  const titleWidth = bold.widthOfTextAtSize(docTitle, 14);
  page.drawText(docTitle, {
    x: PAGE_W - MARGIN - titleWidth,
    y: PAGE_H - 52,
    size: 14,
    font: bold,
    color: WHITE,
  });
  const stampY = PAGE_H - 70;
  const stamp = "Official document";
  const stampW = font.widthOfTextAtSize(stamp, 8);
  page.drawText(stamp, {
    x: PAGE_W - MARGIN - stampW,
    y: stampY,
    size: 8,
    font,
    color: rgb(0.7, 0.75, 0.78),
  });
  ctx.y = PAGE_H - 96 - 34;
}

function drawMetaAndCustomer(ctx: Ctx, d: ReceiptDoc) {
  const { page, font, bold } = ctx;
  const leftX = MARGIN;
  const rightX = PAGE_W / 2 + 10;

  page.drawText("REFERENCE", { x: leftX, y: ctx.y, size: 8, font: bold, color: MUTED });
  page.drawText("ISSUED", { x: rightX, y: ctx.y, size: 8, font: bold, color: MUTED });
  ctx.y -= 14;
  page.drawText(d.reference, { x: leftX, y: ctx.y, size: 11, font: bold, color: INK });
  page.drawText(d.issuedOn, { x: rightX, y: ctx.y, size: 11, font, color: INK });
  ctx.y -= 26;

  page.drawText("BILLED TO", { x: leftX, y: ctx.y, size: 8, font: bold, color: MUTED });
  ctx.y -= 14;
  page.drawText(d.customerName, { x: leftX, y: ctx.y, size: 12, font: bold, color: INK });
  ctx.y -= 14;
  page.drawText(d.customerPhone, { x: leftX, y: ctx.y, size: 10, font, color: MUTED });
  ctx.y -= 24;

  page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 22;
}

function drawSummary(ctx: Ctx, rows: ReceiptRow[]) {
  const { page, font, bold } = ctx;
  const labelX = MARGIN;
  const valueRightX = PAGE_W - MARGIN;
  for (const row of rows) {
    ensureSpace(ctx, 22);
    const size = row.strong ? 12 : 10.5;
    const f = row.strong ? bold : font;
    const color = row.strong ? INK : MUTED;
    page.drawText(row.label, { x: labelX, y: ctx.y, size, font: f, color });
    const valW = (row.strong ? bold : font).widthOfTextAtSize(row.value, size);
    page.drawText(row.value, {
      x: valueRightX - valW,
      y: ctx.y,
      size,
      font: row.strong ? bold : font,
      color: INK,
    });
    ctx.y -= row.strong ? 22 : 18;
  }
}

function drawHighlight(ctx: Ctx, h: { label: string; value: string }) {
  const { page, font, bold } = ctx;
  ensureSpace(ctx, 60);
  ctx.y -= 6;
  const boxH = 48;
  page.drawRectangle({
    x: MARGIN,
    y: ctx.y - boxH,
    width: PAGE_W - MARGIN * 2,
    height: boxH,
    color: rgb(0.9, 0.97, 0.94),
    borderColor: BRAND,
    borderWidth: 1,
  });
  page.drawText(h.label.toUpperCase(), {
    x: MARGIN + 16,
    y: ctx.y - 20,
    size: 9,
    font: bold,
    color: BRAND,
  });
  const valSize = 20;
  page.drawText(h.value, {
    x: MARGIN + 16,
    y: ctx.y - 40,
    size: valSize,
    font: bold,
    color: INK,
  });
  void font;
  ctx.y -= boxH + 24;
}

function drawTable(ctx: Ctx, table: NonNullable<ReceiptDoc["table"]>) {
  const { bold } = ctx;
  ensureSpace(ctx, 60);
  ctx.page.drawText(table.title, {
    x: MARGIN,
    y: ctx.y,
    size: 11,
    font: bold,
    color: INK,
  });
  ctx.y -= 18;

  const usableW = PAGE_W - MARGIN * 2;
  const colCount = table.columns.length;
  const colW = usableW / colCount;
  const rightAlign = new Set(table.rightAlign ?? []);

  // Header row.
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 6,
    width: usableW,
    height: 20,
    color: rgb(0.96, 0.97, 0.98),
  });
  table.columns.forEach((c, i) => {
    const size = 8.5;
    const w = ctx.bold.widthOfTextAtSize(c, size);
    const cellX = MARGIN + i * colW;
    const x = rightAlign.has(i) ? cellX + colW - 8 - w : cellX + 8;
    ctx.page.drawText(c, { x, y: ctx.y, size, font: ctx.bold, color: MUTED });
  });
  ctx.y -= 22;

  // Body rows.
  for (const row of table.rows) {
    ensureSpace(ctx, 20);
    row.forEach((cell, i) => {
      const size = 9.5;
      const w = ctx.font.widthOfTextAtSize(cell, size);
      const cellX = MARGIN + i * colW;
      const x = rightAlign.has(i) ? cellX + colW - 8 - w : cellX + 8;
      ctx.page.drawText(cell, { x, y: ctx.y, size, font: ctx.font, color: INK });
    });
    ctx.y -= 6;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end: { x: PAGE_W - MARGIN, y: ctx.y },
      thickness: 0.5,
      color: LINE,
    });
    ctx.y -= 14;
  }
  ctx.y -= 8;
}

function drawFooter(ctx: Ctx, d: ReceiptDoc) {
  // Draw the footer on every page.
  const pages = ctx.doc.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({
      start: { x: MARGIN, y: 70 },
      end: { x: PAGE_W - MARGIN, y: 70 },
      thickness: 1,
      color: LINE,
    });
    p.drawText(d.tagline, {
      x: MARGIN,
      y: 54,
      size: 10,
      font: ctx.bold,
      color: BRAND,
    });
    const note =
      d.footerNote ??
      "This is a computer-generated document and is valid without a signature.";
    p.drawText(note, { x: MARGIN, y: 40, size: 8, font: ctx.font, color: MUTED });
    const pageLabel = `Page ${idx + 1} of ${pages.length}`;
    const w = ctx.font.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, {
      x: PAGE_W - MARGIN - w,
      y: 40,
      size: 8,
      font: ctx.font,
      color: MUTED,
    });
    p.drawText("Lendo  ·  Dar es Salaam, Tanzania", {
      x: PAGE_W - MARGIN - ctx.font.widthOfTextAtSize("Lendo  ·  Dar es Salaam, Tanzania", 8),
      y: 54,
      size: 8,
      font: ctx.font,
      color: MUTED,
    });
  });
}

export async function buildReceiptPdf(d: ReceiptDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.docTitle} ${d.reference}`);
  doc.setAuthor("Lendo");
  doc.setProducer("Lendo");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, page, font, bold, y: PAGE_H - MARGIN };

  drawHeader(ctx, d.docTitle);
  drawMetaAndCustomer(ctx, d);
  drawSummary(ctx, d.summary);
  if (d.highlight) drawHighlight(ctx, d.highlight);
  if (d.table) drawTable(ctx, d.table);
  drawFooter(ctx, d);

  return doc.save();
}
