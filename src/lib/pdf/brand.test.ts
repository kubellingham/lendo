import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildReceiptPdf } from "@/lib/pdf/receipt";
import { contactLine, DEFAULT_BRANDING, nameLine, wrap } from "@/lib/pdf/brand";

// 1×1 transparent PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const doc = {
  docTitle: "PAYMENT RECEIPT",
  reference: "LND-TEST01",
  issuedOn: "11 Nov 2026",
  customerName: "Test",
  customerPhone: "+255700000000",
  summary: [{ label: "Amount", value: "TSh 1,000" }],
  tagline: "Thanks",
};

describe("PDF branding", () => {
  it("builds with a logo, without one, and with a broken image", async () => {
    for (const logo of [PNG, "", "data:image/png;base64,notanimage"]) {
      const bytes = await buildReceiptPdf(doc, { ...DEFAULT_BRANDING, logo });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getAuthor()).toBe("Lendo");
    }
  });

  it("formats the footer and header lines", () => {
    expect(nameLine(DEFAULT_BRANDING)).toBe("Lendo  ·  Dodoma, Tanzania");
    expect(contactLine(DEFAULT_BRANDING)).toBe("+255 786 776 677  ·  ikube77@gmail.com");
    expect(contactLine({ ...DEFAULT_BRANDING, email: "" })).toBe("+255 786 776 677");
  });

  it("wraps a long tagline onto two lines", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrap(font, "Borrow with confidence. Repay with ease, every single time, no matter what.", 9, 150);
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});
