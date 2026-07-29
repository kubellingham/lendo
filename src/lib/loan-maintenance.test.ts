import { describe, it, expect } from "vitest";
import { neededCycleCount } from "@/lib/loan-maintenance";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("neededCycleCount", () => {
  const disbursed = D("2026-01-01");

  it("keeps the agreed 3 cycles within the term", () => {
    expect(neededCycleCount(disbursed, D("2026-01-01"), 30, 3)).toBe(3);
    expect(neededCycleCount(disbursed, D("2026-02-10"), 30, 3)).toBe(3); // day 40
    expect(neededCycleCount(disbursed, D("2026-03-31"), 30, 3)).toBe(3); // day 89
  });

  it("adds a 4th cycle once past day 90", () => {
    // day 91
    expect(neededCycleCount(disbursed, D("2026-04-02"), 30, 3)).toBe(4);
  });

  it("adds one cycle per extra 30-day period", () => {
    expect(neededCycleCount(disbursed, D("2026-05-02"), 30, 3)).toBe(5); // ~day 121
    expect(neededCycleCount(disbursed, D("2026-06-01"), 30, 3)).toBe(6); // ~day 151
  });

  it("caps runaway growth", () => {
    expect(neededCycleCount(disbursed, D("2035-01-01"), 30, 3)).toBe(36);
  });
});
