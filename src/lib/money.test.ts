import { describe, it, expect } from "vitest";
import { add, subtract, percentOf, toDbString, formatTZS } from "@/lib/money";

describe("money", () => {
  it("adds many payments without losing cents", () => {
    // 0.10 + 0.20 in floating point is 0.30000000000000004; Decimal must not.
    const sum = add("0.10", "0.20");
    expect(sum.toFixed(2)).toBe("0.30");
  });

  it("sums a long ledger exactly", () => {
    const payments = Array.from({ length: 1000 }, () => "15000.33");
    const total = add(...payments);
    expect(total.toFixed(2)).toBe("15000330.00");
  });

  it("subtracts to track outstanding balance", () => {
    expect(subtract("115000", "15000").toFixed(2)).toBe("100000.00");
  });

  it("computes percentage interest", () => {
    expect(percentOf("100000", 15).toFixed(2)).toBe("15000.00");
    expect(percentOf("33333", 15).toFixed(2)).toBe("4999.95");
  });

  it("serializes to a canonical 2dp string", () => {
    expect(toDbString("100000")).toBe("100000.00");
    expect(toDbString(4999.95)).toBe("4999.95");
  });

  it("formats TZS for display", () => {
    expect(formatTZS("100000")).toContain("100,000");
  });
});
