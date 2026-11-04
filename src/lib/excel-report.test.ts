import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildBusinessWorkbook,
  monthsBetween,
  parseMonth,
  type BusinessReport,
} from "@/lib/excel-report";
import { parseIsoDate } from "@/lib/dates";

const report: BusinessReport = {
  periodLabel: "September 2026 – October 2026",
  fileLabel: "Sep-2026-to-Oct-2026",
  preparedBy: "Innocent Kube",
  preparedOn: parseIsoDate("2026-11-04"),
  months: [
    { month: "September 2026", newLoans: 1, lentOut: 1000000, received: 0, profit: 0, principalBack: 0, owedAtEnd: 1000000 },
    { month: "October 2026", newLoans: 0, lentOut: 0, received: 550000, profit: 150000, principalBack: 400000, owedAtEnd: 600000 },
  ],
  loans: [
    {
      month: "September 2026", ref: "LND-ABC123", borrower: "Ansbert", phone: "+255712000111",
      givenOn: parseIsoDate("2026-09-10"), amount: 1000000, ratePct: 15, rounds: 3,
      finalDue: parseIsoDate("2026-12-09"), paidSoFar: 550000, profitSoFar: 150000,
      stillOwed: 690000, status: "Active", givenBy: "Innocent Kube",
    },
  ],
  payments: [
    {
      month: "October 2026", paidOn: parseIsoDate("2026-10-12"), borrower: "Ansbert",
      phone: "+255712000111", ref: "LND-ABC123", loanGivenOn: parseIsoDate("2026-09-10"),
      loanAmount: 1000000, round: "Round 1 of 3", roundDue: parseIsoDate("2026-10-10"),
      timing: "2 day(s) late", amount: 550000, profit: 150000, principal: 400000,
      method: "Bank", recordedBy: "Innocent Kube",
    },
  ],
  people: [
    {
      name: "Ansbert", phone: "+255712000111", score: 88, band: "Excellent", referral: "Grace",
      borrowed: 1000000, paid: 550000, profit: 150000, owes: 690000, latePayments: 1, alert: "",
      loans: [
        {
          ref: "LND-ABC123", givenOn: parseIsoDate("2026-09-10"), amount: 1000000, ratePct: 15,
          rounds: 3, finalDue: parseIsoDate("2026-12-09"), status: "Active", givenBy: "Innocent Kube",
          totalPaid: 550000, profit: 150000, principalPaid: 400000, stillOwes: 690000,
          lines: [
            { round: "Round 1", dueDate: parseIsoDate("2026-10-10"), opening: 1000000, minimumDue: 150000,
              paidOn: parseIsoDate("2026-10-12"), paid: 550000, profit: 150000, principal: 400000,
              status: "2 day(s) late", tone: "late" },
            { round: "Round 2", dueDate: parseIsoDate("2026-11-09"), opening: 600000, minimumDue: 90000,
              paidOn: null, paid: null, profit: null, principal: null,
              status: "Not due yet (in 5 day(s))", tone: "neutral" },
          ],
        },
      ],
    },
  ],
};

describe("business Excel report", () => {
  it("has the four sheets with formulas that point at the detail sheets", async () => {
    const buf = await buildBusinessWorkbook(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary", "By borrower", "Month by month", "Loans given", "Payments received",
    ]);
    const sum = wb.getWorksheet("Summary")!;
    expect(sum.getCell("A7").value).toBe("October 2026");
    const profit = sum.getCell("E7").value as { formula: string; result: number };
    expect(profit.formula).toContain("'Payments received'!$L$6");
    expect(profit.result).toBe(150000);
    const total = sum.getCell("E8").value as { formula: string; result: number };
    expect(total.formula).toBe("SUM(E6:E7)");
    expect(total.result).toBe(150000);

    const pay = wb.getWorksheet("Payments received")!;
    expect(pay.getCell("C6").value).toBe("Ansbert");
    expect(pay.getCell("H6").value).toBe("Round 1 of 3");
    expect(pay.getCell("L6").value).toBe(150000);
  });

  it("By borrower tab: index links to each person's block with rounds and totals", async () => {
    const buf = await buildBusinessWorkbook(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("By borrower")!;
    const link = ws.getCell("A7").value as { text: string; hyperlink: string };
    expect(link.text).toBe("Ansbert");
    const target = Number(link.hyperlink.split("!A")[1]);
    expect(ws.getCell(`A${target}`).value).toBe("ANSBERT");
    // loan line, header, then the round rows
    expect(String(ws.getCell(`A${target + 2}`).value)).toContain("Loan LND-ABC123");
    expect(ws.getCell(`A${target + 4}`).value).toBe("Round 1");
    expect(ws.getCell(`I${target + 4}`).value).toBe("2 day(s) late");
    expect(ws.getCell(`I${target + 5}`).value).toBe("Not due yet (in 5 day(s))");
    const total = ws.getCell(`G${target + 6}`).value as { formula: string; result: number };
    expect(total.result).toBe(150000);
  });

  it("month helpers", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(monthsBetween(parseMonth("2026-11")!, parseMonth("2027-02")!)).toHaveLength(4);
    expect(monthsBetween(parseMonth("2026-11")!, parseMonth("2026-10")!)).toHaveLength(0);
  });
});
