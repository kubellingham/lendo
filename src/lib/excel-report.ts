import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { computeLoanState } from "@/lib/loan-calc";
import { money, round2 } from "@/lib/money";
import { formatDate, toBusinessDate } from "@/lib/dates";
import { attributeInterest, loanRef, type LoanFull } from "@/lib/reporting";

// ---------------------------------------------------------------------------
// "Business report" Excel workbook — a plain, shareable record of the business
// for people who prefer Excel over the app. Four sheets:
//   1. Summary         month-by-month totals (formulas read from sheets 3 + 4)
//   2. Month by month  an easy-to-read statement, one block per month
//   3. Loans given     every loan handed out in the period
//   4. Payments        every payment received in the period
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_MONTHS = 36;
const DAY = 24 * 60 * 60 * 1000;

export type MonthKey = { year: number; month: number }; // month 1–12

export function parseMonth(s: string | null | undefined): MonthKey | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

export function monthLabel(k: MonthKey): string {
  return `${MONTH_NAMES[k.month - 1]} ${k.year}`;
}

function monthStart(k: MonthKey): Date {
  return new Date(Date.UTC(k.year, k.month - 1, 1));
}

function nextMonth(k: MonthKey): MonthKey {
  return k.month === 12 ? { year: k.year + 1, month: 1 } : { year: k.year, month: k.month + 1 };
}

function keyOf(d: Date): MonthKey {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Every month from `from` to `to` inclusive (capped at 36). */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let k = from;
  while (
    (k.year < to.year || (k.year === to.year && k.month <= to.month)) &&
    out.length < MAX_MONTHS
  ) {
    out.push(k);
    k = nextMonth(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type LoanRow = {
  month: string;
  ref: string;
  borrower: string;
  phone: string;
  givenOn: Date;
  amount: number;
  ratePct: number;
  rounds: number;
  finalDue: Date;
  paidSoFar: number;
  profitSoFar: number;
  stillOwed: number;
  status: string;
  givenBy: string;
};

export type PaymentRow = {
  month: string;
  paidOn: Date;
  borrower: string;
  phone: string;
  ref: string;
  loanGivenOn: Date;
  loanAmount: number;
  round: string;
  roundDue: Date | null;
  timing: string;
  amount: number;
  profit: number;
  principal: number;
  method: string;
  recordedBy: string;
};

export type MonthTotals = {
  month: string;
  newLoans: number;
  lentOut: number;
  received: number;
  profit: number;
  principalBack: number;
  owedAtEnd: number;
};

/** One line in a person's loan table: a round, a payment, or a status note. */
export type RoundLine = {
  round: string; // "" on extra payment lines of the same round
  dueDate: Date | null;
  opening: number | null; // balance at the start of the round
  minimumDue: number | null; // interest, or full settlement on the final round
  paidOn: Date | null;
  paid: number | null;
  profit: number | null;
  principal: number | null;
  status: string;
  tone: "ok" | "late" | "overdue" | "muted" | "neutral";
};

export type PersonLoan = {
  ref: string;
  givenOn: Date;
  amount: number;
  ratePct: number;
  rounds: number;
  finalDue: Date;
  status: string;
  givenBy: string;
  lines: RoundLine[];
  totalPaid: number;
  profit: number;
  principalPaid: number;
  stillOwes: number;
};

export type PersonBlock = {
  name: string;
  phone: string;
  score: number;
  band: string;
  referral: string | null;
  loans: PersonLoan[];
  borrowed: number;
  paid: number;
  profit: number;
  owes: number;
  latePayments: number;
  /** e.g. "OVERDUE 12 days" when a round is past due right now, else "". */
  alert: string;
};

export type BusinessReport = {
  periodLabel: string;
  fileLabel: string;
  preparedBy: string;
  preparedOn: Date;
  months: MonthTotals[];
  loans: LoanRow[];
  payments: PaymentRow[];
  people: PersonBlock[];
};

const BAND_LABEL: Record<string, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  WATCH: "Watch",
  HIGH_RISK: "High risk",
  CRITICAL: "Critical",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  OVERDUE: "Overdue",
  DEFAULTED: "Defaulted",
  SETTLED: "Fully repaid",
  WRITTEN_OFF: "Written off",
};

const n = (d: Decimal) => round2(d).toNumber();

function timingLabel(due: Date | null, paidAt: Date): string {
  if (!due) return "—";
  const diff = Math.round(
    (toBusinessDate(paidAt).getTime() - toBusinessDate(due).getTime()) / DAY,
  );
  if (diff > 0) return `${diff} day(s) late`;
  if (diff < 0) return `${-diff} day(s) early`;
  return "On the due date";
}

export async function gatherBusinessReport(
  from: MonthKey,
  to: MonthKey,
  preparedBy: string,
): Promise<BusinessReport> {
  const months = monthsBetween(from, to);
  const start = monthStart(months[0]);
  const end = monthStart(nextMonth(months[months.length - 1]));

  // All loans: the period figures filter by date below, and each person's
  // block shows their full history.
  const loansRaw = await db.loan.findMany({
    orderBy: { disbursedAt: "asc" },
    include: {
      customer: {
        select: {
          id: true,
          fullName: true,
          phone: true,
          riskScore: true,
          riskBand: true,
          referralName: true,
          referralPhone: true,
        },
      },
      issuedBy: { select: { name: true } },
      installments: { orderBy: { cycleNumber: "asc" } },
      payments: {
        select: {
          id: true,
          amount: true,
          installmentId: true,
          paidAt: true,
          createdAt: true,
          method: true,
          recordedBy: { select: { name: true } },
          installment: { select: { dueDate: true } },
        },
      },
    },
  });
  const loans = loansRaw as unknown as (LoanFull & {
    status: string;
    issuedBy: { name: string };
  })[];

  const loanRows: LoanRow[] = [];
  const paymentRows: PaymentRow[] = [];
  const today = toBusinessDate(new Date());
  const people = new Map<string, { include: boolean; block: PersonBlock }>();
  const totals = new Map<string, MonthTotals>(
    months.map((k) => [
      monthLabel(k),
      {
        month: monthLabel(k),
        newLoans: 0,
        lentOut: 0,
        received: 0,
        profit: 0,
        principalBack: 0,
        owedAtEnd: 0,
      },
    ]),
  );

  for (const loan of loans) {
    const interestByPayment = attributeInterest(loan);
    const all = computeLoanState({
      principal: loan.principal,
      status: "ACTIVE",
      interestRatePct: loan.interestRatePct,
      installments: loan.installments,
      payments: loan.payments,
    });
    const ref = loanRef(loan.id);
    const cycleById = new Map(loan.installments.map((i) => [i.id, i.cycleNumber]));

    // ---- Per-person detail (full history of this loan)
    const inPeriod =
      (loan.disbursedAt >= start && loan.disbursedAt < end) ||
      loan.payments.some((p) => p.paidAt >= start && p.paidAt < end);
    const owesNow =
      loan.status !== "WRITTEN_OFF" && !all.isSettled && all.principalOutstanding.gt(0);
    const person =
      people.get(loan.customer.id) ??
      people
        .set(loan.customer.id, {
          include: false,
          block: {
            name: loan.customer.fullName,
            phone: loan.customer.phone,
            score: loan.customer.riskScore,
            band: BAND_LABEL[loan.customer.riskBand] ?? loan.customer.riskBand,
            referral: loan.customer.referralName,
            loans: [],
            borrowed: 0,
            paid: 0,
            profit: 0,
            owes: 0,
            latePayments: 0,
            alert: "",
          },
        })
        .get(loan.customer.id)!;
    if (inPeriod || owesNow) person.include = true;
    const pl = personLoan(loan, all, interestByPayment, ref, today);
    person.block.loans.push(pl);
    person.block.borrowed += pl.amount;
    person.block.paid += pl.totalPaid;
    person.block.profit += pl.profit;
    person.block.owes += pl.stillOwes;
    person.block.latePayments += pl.lines.filter((l) => l.tone === "late").length;
    const overdue = pl.lines.find((l) => l.tone === "overdue");
    if (overdue && !person.block.alert) person.block.alert = overdue.status;

    if (loan.disbursedAt >= start && loan.disbursedAt < end) {
      const label = monthLabel(keyOf(loan.disbursedAt));
      const t = totals.get(label)!;
      t.newLoans++;
      t.lentOut += money(loan.principal).toNumber();
      let profitSoFar = money(0);
      for (const v of interestByPayment.values()) profitSoFar = profitSoFar.plus(v);
      loanRows.push({
        month: label,
        ref,
        borrower: loan.customer.fullName,
        phone: loan.customer.phone,
        givenOn: loan.disbursedAt,
        amount: money(loan.principal).toNumber(),
        ratePct: loan.interestRatePct,
        rounds: loan.cyclesAllowed,
        finalDue: loan.dueAt,
        paidSoFar: n(all.totalCollected),
        profitSoFar: n(profitSoFar),
        stillOwed: n(all.isSettled ? money(0) : all.settlementAmountNow),
        status: STATUS_LABEL[loan.status] ?? loan.status,
        givenBy: loan.issuedBy.name,
      });
    }

    for (const p of loan.payments) {
      if (p.paidAt < start || p.paidAt >= end) continue;
      const label = monthLabel(keyOf(p.paidAt));
      const profit = interestByPayment.get(p.id) ?? money(0);
      const amount = money(p.amount);
      const t = totals.get(label)!;
      t.received += amount.toNumber();
      t.profit += n(profit);
      t.principalBack += n(amount.minus(profit));
      const cycle = p.installmentId ? cycleById.get(p.installmentId) : undefined;
      paymentRows.push({
        month: label,
        paidOn: toBusinessDate(p.paidAt),
        borrower: loan.customer.fullName,
        phone: loan.customer.phone,
        ref,
        loanGivenOn: loan.disbursedAt,
        loanAmount: money(loan.principal).toNumber(),
        round: cycle ? `Round ${cycle} of ${loan.cyclesAllowed}` : "—",
        roundDue: p.installment?.dueDate ?? null,
        timing: timingLabel(p.installment?.dueDate ?? null, p.paidAt),
        amount: amount.toNumber(),
        profit: n(profit),
        principal: n(amount.minus(profit)),
        method: p.method.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
        recordedBy: p.recordedBy?.name ?? "—",
      });
    }

    // Still owed at the end of each month (principal + that round's interest).
    for (const k of months) {
      const mEnd = monthStart(nextMonth(k));
      if (loan.disbursedAt >= mEnd) continue;
      const st = computeLoanState({
        principal: loan.principal,
        status: "ACTIVE",
        interestRatePct: loan.interestRatePct,
        installments: loan.installments,
        payments: loan.payments.filter((p) => p.paidAt < mEnd),
      });
      if (st.principalOutstanding.gt(0)) {
        totals.get(monthLabel(k))!.owedAtEnd += n(st.principalOutstanding);
      }
    }
  }

  paymentRows.sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime());
  loanRows.sort((a, b) => a.givenOn.getTime() - b.givenOn.getTime());

  const first = months[0];
  const last = months[months.length - 1];
  const short = (k: MonthKey) => `${MONTH_NAMES[k.month - 1].slice(0, 3)}-${k.year}`;
  return {
    periodLabel:
      months.length === 1 ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`,
    fileLabel: months.length === 1 ? short(first) : `${short(first)}-to-${short(last)}`,
    preparedBy,
    preparedOn: new Date(),
    months: [...totals.values()].map((t) => ({
      ...t,
      lentOut: Math.round(t.lentOut * 100) / 100,
      received: Math.round(t.received * 100) / 100,
      profit: Math.round(t.profit * 100) / 100,
      principalBack: Math.round(t.principalBack * 100) / 100,
      owedAtEnd: Math.round(t.owedAtEnd * 100) / 100,
    })),
    loans: loanRows,
    payments: paymentRows,
    people: [...people.values()]
      .filter((x) => x.include)
      .map((x) => x.block)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A loan's full story, round by round, with every payment against it. */
function personLoan(
  loan: LoanFull & { status: string; issuedBy: { name: string } },
  all: ReturnType<typeof computeLoanState>,
  interestByPayment: Map<string, Decimal>,
  ref: string,
  today: Date,
): PersonLoan {
  const lines: RoundLine[] = [];
  const settled = all.isSettled;
  const byInst = new Map<string, LoanFull["payments"]>();
  const loose: LoanFull["payments"] = [];
  for (const p of [...loan.payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())) {
    if (p.installmentId) {
      (byInst.get(p.installmentId) ?? byInst.set(p.installmentId, []).get(p.installmentId)!).push(p);
    } else loose.push(p);
  }

  let totalPaid = money(0);
  let profit = money(0);
  const payLine = (p: LoanFull["payments"][number], due: Date | null): Omit<RoundLine, "round" | "dueDate" | "opening" | "minimumDue"> => {
    const amt = money(p.amount);
    const prof = interestByPayment.get(p.id) ?? money(0);
    totalPaid = totalPaid.plus(amt);
    profit = profit.plus(prof);
    const timing = timingLabel(due, p.paidAt);
    return {
      paidOn: toBusinessDate(p.paidAt),
      paid: amt.toNumber(),
      profit: n(prof),
      principal: n(amt.minus(prof)),
      status: timing,
      tone: timing.includes("late") ? "late" : "ok",
    };
  };

  for (const inst of loan.installments) {
    const isFinal = inst.cycleNumber === loan.cyclesAllowed;
    const extra = inst.cycleNumber > loan.cyclesAllowed;
    const opening = all.perInstallmentOpeningPrincipal[inst.id] ?? money(0);
    const owed = all.perInstallmentInterestOwed[inst.id] ?? money(0);
    const paidHere = all.perInstallmentPaid[inst.id] ?? money(0);
    const minimum = isFinal ? opening.plus(owed) : owed;
    const label = `Round ${inst.cycleNumber}${extra ? " (extra)" : isFinal ? " (final)" : ""}`;
    const head = {
      round: label,
      dueDate: inst.dueDate,
      opening: n(opening),
      minimumDue: n(minimum),
    };
    const pmts = byInst.get(inst.id) ?? [];

    // Nothing was owed: the loan was already cleared before this round.
    if (owed.lte(0) && pmts.length === 0) {
      lines.push({
        ...head, opening: null, minimumDue: null,
        paidOn: null, paid: null, profit: null, principal: null,
        status: "Not needed — loan already cleared", tone: "muted",
      });
      continue;
    }

    pmts.forEach((p, i) => {
      const base = i === 0 ? head : { round: "", dueDate: null, opening: null, minimumDue: null };
      lines.push({ ...base, ...payLine(p, inst.dueDate) });
    });

    // Is this round still open?
    const covered = settled || owed.lte(0) || paidHere.gte(isFinal ? minimum : owed);
    if (!covered) {
      const days = Math.round((today.getTime() - toBusinessDate(inst.dueDate).getTime()) / DAY);
      const left = n((isFinal ? minimum : owed).minus(paidHere));
      const status =
        days > 0
          ? `OVERDUE ${days} day(s) — TSh ${left.toLocaleString("en-US")} unpaid`
          : days === 0
            ? `Due today — TSh ${left.toLocaleString("en-US")}`
            : `Not due yet (in ${-days} day(s))`;
      const tone: RoundLine["tone"] = days > 0 ? "overdue" : "neutral";
      if (pmts.length === 0) {
        lines.push({ ...head, paidOn: null, paid: null, profit: null, principal: null, status, tone });
      } else {
        lines.push({
          round: "", dueDate: null, opening: null, minimumDue: null,
          paidOn: null, paid: null, profit: null, principal: null,
          status: `Part paid — ${status}`, tone,
        });
      }
    }
  }

  for (const p of loose) {
    lines.push({ round: "Other payment", dueDate: null, opening: null, minimumDue: null, ...payLine(p, null) });
  }

  return {
    ref,
    givenOn: loan.disbursedAt,
    amount: money(loan.principal).toNumber(),
    ratePct: loan.interestRatePct,
    rounds: loan.cyclesAllowed,
    finalDue: loan.dueAt,
    status: STATUS_LABEL[loan.status] ?? loan.status,
    givenBy: loan.issuedBy.name,
    lines,
    totalPaid: n(totalPaid),
    profit: n(profit),
    principalPaid: n(totalPaid.minus(profit)),
    stillOwes: n(settled || loan.status === "WRITTEN_OFF" ? money(0) : all.settlementAmountNow),
  };
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

const MONEY = "#,##0";
const DATE = "dd mmm yyyy";
const BRAND = "FF0F172A"; // slate-900
const HEAD_FILL = "FFE2E8F0"; // slate-200
const BAND_FILL = "FFF1F5F9"; // slate-100
const PROFIT_FILL = "FFDCFCE7"; // green-100

function headerRow(ws: ExcelJS.Worksheet, rowNo: number, labels: string[]) {
  const row = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  row.height = 32;
}

function title(ws: ExcelJS.Worksheet, text: string, sub: string[]) {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: BRAND } };
  sub.forEach((s, i) => {
    ws.getCell(`A${i + 2}`).value = s;
    ws.getCell(`A${i + 2}`).font = { color: { argb: "FF475569" } };
  });
}

function colLetter(i: number): string {
  return String.fromCharCode(64 + i); // 1 → A (enough for ≤ 26 columns)
}

export async function buildBusinessWorkbook(r: BusinessReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lendo";
  wb.created = r.preparedOn;
  // Recalculate every formula when the file is opened (exceljs drops cached
  // results of 0, which some viewers would otherwise show as blank).
  wb.calcProperties = { fullCalcOnLoad: true };
  const sub = [
    `Period: ${r.periodLabel}`,
    `Prepared on ${formatDate(r.preparedOn)} by ${r.preparedBy}. All amounts in Tanzanian shillings (TSh).`,
  ];

  // ---- Sheet 3: Loans given (built first so Summary formulas can refer to it)
  const wsSum = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  const wsPeople = wb.addWorksheet("By borrower", { views: [{ showGridLines: false }] });
  const wsMonth = wb.addWorksheet("Month by month", { views: [{ showGridLines: false }] });
  const wsLoans = wb.addWorksheet("Loans given", { views: [{ state: "frozen", ySplit: 5 }] });
  const wsPay = wb.addWorksheet("Payments received", { views: [{ state: "frozen", ySplit: 5 }] });

  title(wsLoans, "Loans given out", [
    ...sub,
    "Who borrowed, when, how much, and how much they have paid back so far (up to today).",
  ]);
  const loanCols = [
    ["Month", 16], ["Loan ref", 12], ["Borrower", 24], ["Phone", 16],
    ["Date given", 13], ["Amount lent", 14], ["Interest per round", 11],
    ["Rounds agreed", 9], ["Final due date", 13], ["Paid back so far", 15],
    ["Profit (interest) so far", 15], ["Still owed today", 15], ["Status", 13],
    ["Given by", 18],
  ] as const;
  headerRow(wsLoans, 5, loanCols.map((c) => c[0]));
  loanCols.forEach((c, i) => (wsLoans.getColumn(i + 1).width = c[1]));
  r.loans.forEach((l, i) => {
    const row = wsLoans.getRow(6 + i);
    row.values = [
      l.month, l.ref, l.borrower, l.phone, l.givenOn, l.amount, l.ratePct / 100,
      l.rounds, l.finalDue, l.paidSoFar, l.profitSoFar, l.stillOwed, l.status, l.givenBy,
    ];
  });
  const loanLast = 5 + r.loans.length;
  for (const c of [5, 9]) wsLoans.getColumn(c).numFmt = DATE;
  for (const c of [6, 10, 11, 12]) wsLoans.getColumn(c).numFmt = MONEY;
  wsLoans.getColumn(7).numFmt = "0%";
  if (r.loans.length) {
    wsLoans.autoFilter = { from: "A5", to: `N${loanLast}` };
    const tot = wsLoans.getRow(loanLast + 1);
    tot.getCell(3).value = "TOTAL";
    for (const c of [6, 10, 11, 12]) {
      const L = colLetter(c);
      const result = r.loans.reduce(
        (s, l) => s + (c === 6 ? l.amount : c === 10 ? l.paidSoFar : c === 11 ? l.profitSoFar : l.stillOwed),
        0,
      );
      tot.getCell(c).value = { formula: `SUM(${L}6:${L}${loanLast})`, result };
    }
    tot.font = { bold: true };
    tot.border = { top: { style: "thin" } };
  } else {
    wsLoans.getCell("A6").value = "No loans were given out in this period.";
  }

  // ---- Sheet 4: Payments received
  title(wsPay, "Payments received", [
    ...sub,
    "Every payment, which loan and round it was for, and how much of it was profit (interest).",
  ]);
  const payCols = [
    ["Month", 16], ["Date paid", 13], ["Borrower", 24], ["Phone", 16],
    ["Loan ref", 12], ["Loan given on", 13], ["Loan amount", 14], ["Round", 13],
    ["Round due date", 13], ["Paid on time?", 16], ["Amount paid", 14],
    ["Profit (interest)", 15], ["Principal returned", 15], ["Method", 13],
    ["Recorded by", 18],
  ] as const;
  headerRow(wsPay, 5, payCols.map((c) => c[0]));
  payCols.forEach((c, i) => (wsPay.getColumn(i + 1).width = c[1]));
  r.payments.forEach((p, i) => {
    const row = wsPay.getRow(6 + i);
    row.values = [
      p.month, p.paidOn, p.borrower, p.phone, p.ref, p.loanGivenOn, p.loanAmount,
      p.round, p.roundDue ?? "—", p.timing, p.amount, p.profit, p.principal,
      p.method, p.recordedBy,
    ];
    row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROFIT_FILL } };
    if (p.timing.includes("late")) row.getCell(10).font = { color: { argb: "FFB91C1C" } };
  });
  const payLast = 5 + r.payments.length;
  for (const c of [2, 6, 9]) wsPay.getColumn(c).numFmt = DATE;
  for (const c of [7, 11, 12, 13]) wsPay.getColumn(c).numFmt = MONEY;
  if (r.payments.length) {
    wsPay.autoFilter = { from: "A5", to: `O${payLast}` };
    const tot = wsPay.getRow(payLast + 1);
    tot.getCell(3).value = "TOTAL";
    const sums: Record<number, number> = {
      11: r.payments.reduce((s, p) => s + p.amount, 0),
      12: r.payments.reduce((s, p) => s + p.profit, 0),
      13: r.payments.reduce((s, p) => s + p.principal, 0),
    };
    for (const c of [11, 12, 13]) {
      const L = colLetter(c);
      tot.getCell(c).value = { formula: `SUM(${L}6:${L}${payLast})`, result: sums[c] };
    }
    tot.font = { bold: true };
  } else {
    wsPay.getCell("A6").value = "No payments were received in this period.";
  }

  // ---- Sheet 1: Summary (each figure is a formula over the detail sheets)
  title(wsSum, "Lendo — Business summary", sub);
  const sumCols = [
    ["Month", 18], ["New loans", 10], ["Money lent out", 16],
    ["Money received", 16], ["Profit (interest earned)", 17],
    ["Principal returned", 16], ["Cash in minus cash out", 17],
    ["Still owed to us at month end", 18],
  ] as const;
  headerRow(wsSum, 5, sumCols.map((c) => c[0]));
  sumCols.forEach((c, i) => (wsSum.getColumn(i + 1).width = c[1]));
  const L = `'Loans given'`;
  const P = `'Payments received'`;
  r.months.forEach((m, i) => {
    const rn = 6 + i;
    const row = wsSum.getRow(rn);
    row.getCell(1).value = m.month;
    row.getCell(2).value = {
      formula: `COUNTIF(${L}!$A$6:$A$${Math.max(6, loanLast)},A${rn})`,
      result: m.newLoans,
    };
    row.getCell(3).value = {
      formula: `SUMIF(${L}!$A$6:$A$${Math.max(6, loanLast)},A${rn},${L}!$F$6:$F$${Math.max(6, loanLast)})`,
      result: m.lentOut,
    };
    const pr = Math.max(6, payLast);
    row.getCell(4).value = {
      formula: `SUMIF(${P}!$A$6:$A$${pr},A${rn},${P}!$K$6:$K$${pr})`,
      result: m.received,
    };
    row.getCell(5).value = {
      formula: `SUMIF(${P}!$A$6:$A$${pr},A${rn},${P}!$L$6:$L$${pr})`,
      result: m.profit,
    };
    row.getCell(6).value = {
      formula: `SUMIF(${P}!$A$6:$A$${pr},A${rn},${P}!$M$6:$M$${pr})`,
      result: m.principalBack,
    };
    row.getCell(7).value = { formula: `D${rn}-C${rn}`, result: m.received - m.lentOut };
    row.getCell(8).value = m.owedAtEnd;
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROFIT_FILL } };
    row.getCell(5).font = { bold: true, color: { argb: "FF166534" } };
  });
  const sumLast = 5 + r.months.length;
  for (const c of [3, 4, 5, 6, 7, 8]) wsSum.getColumn(c).numFmt = MONEY;
  wsSum.getColumn(7).numFmt = `${MONEY};[Red]-${MONEY}`;
  const totRow = wsSum.getRow(sumLast + 1);
  totRow.getCell(1).value = "TOTAL";
  const tot = (f: (m: MonthTotals) => number) => r.months.reduce((s, m) => s + f(m), 0);
  const totVals: Record<number, number> = {
    2: tot((m) => m.newLoans),
    3: tot((m) => m.lentOut),
    4: tot((m) => m.received),
    5: tot((m) => m.profit),
    6: tot((m) => m.principalBack),
  };
  for (const c of [2, 3, 4, 5, 6]) {
    const C = colLetter(c);
    totRow.getCell(c).value = { formula: `SUM(${C}6:${C}${sumLast})`, result: totVals[c] };
  }
  totRow.getCell(7).value = {
    formula: `D${sumLast + 1}-C${sumLast + 1}`,
    result: totVals[4] - totVals[3],
  };
  totRow.font = { bold: true };
  for (let c = 1; c <= 8; c++) {
    totRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
    totRow.getCell(c).border = { top: { style: "thin" } };
  }
  totRow.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROFIT_FILL } };

  const notesStart = sumLast + 3;
  const notes = [
    "How to read this",
    "• Money lent out — cash handed to borrowers as new loans that month.",
    "• Money received — everything borrowers paid back that month.",
    "• Profit (interest earned) — the part of what they paid that is interest (15% of the balance per 30-day round). This is what the business earned.",
    "• Principal returned — the part that pays back the amount we lent. It is our own money coming back, not profit.",
    "• Cash in minus cash out — Money received minus Money lent out. It can be negative in a month with many new loans; that money comes back later as principal plus profit.",
    "• Still owed to us — loan balances not yet repaid at the end of the month.",
    "• Every figure above is calculated from the 'Loans given' and 'Payments received' sheets, so each one can be checked line by line.",
  ];
  notes.forEach((t, i) => {
    const c = wsSum.getCell(`A${notesStart + i}`);
    c.value = t;
    c.font = i === 0 ? { bold: true } : { color: { argb: "FF334155" } };
  });

  // ---- Sheet 2: Month by month (readable statement)
  title(wsMonth, "Month by month", [
    ...sub,
    "For each month: who was given a loan, who paid, and what the month made.",
  ]);
  [14, 24, 12, 15, 14, 15, 15, 18].forEach((w, i) => (wsMonth.getColumn(i + 1).width = w));
  wsMonth.getColumn(1).alignment = { horizontal: "left" };
  wsMonth.getColumn(8).alignment = { horizontal: "left", indent: 1 };
  let rn = 5;
  for (const m of r.months) {
    const band = wsMonth.getRow(rn);
    band.getCell(1).value = m.month.toUpperCase();
    for (let c = 1; c <= 8; c++) {
      band.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
      band.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
    rn += 1;

    // Loans given out this month
    const given = r.loans.filter((l) => l.month === m.month);
    wsMonth.getCell(`A${rn}`).value = "Loans given out";
    wsMonth.getCell(`A${rn}`).font = { bold: true };
    rn += 1;
    if (given.length) {
      headerRow(wsMonth, rn, ["Date", "Borrower", "Loan ref", "Rounds", "Amount lent", "", "", "Given by"]);
      wsMonth.getRow(rn).height = 30;
      rn += 1;
      const first = rn;
      for (const l of given) {
        wsMonth.getRow(rn).values = [l.givenOn, l.borrower, l.ref, `${l.rounds} rounds`, l.amount, null, null, l.givenBy];
        wsMonth.getCell(`A${rn}`).numFmt = DATE;
        wsMonth.getCell(`E${rn}`).numFmt = MONEY;
        rn += 1;
      }
      wsMonth.getCell(`D${rn}`).value = "Total lent out";
      wsMonth.getCell(`E${rn}`).value = { formula: `SUM(E${first}:E${rn - 1})`, result: m.lentOut };
      wsMonth.getCell(`E${rn}`).numFmt = MONEY;
      wsMonth.getRow(rn).font = { bold: true };
      rn += 1;
    } else {
      wsMonth.getCell(`A${rn}`).value = "No new loans this month.";
      wsMonth.getCell(`A${rn}`).font = { italic: true, color: { argb: "FF64748B" } };
      rn += 1;
    }
    rn += 1;

    // Payments received this month
    const paid = r.payments.filter((p) => p.month === m.month);
    wsMonth.getCell(`A${rn}`).value = "Payments received";
    wsMonth.getCell(`A${rn}`).font = { bold: true };
    rn += 1;
    if (paid.length) {
      headerRow(wsMonth, rn, ["Date paid", "Borrower", "Loan ref", "Round", "Amount paid", "Profit (interest)", "Principal returned", "Paid on time?"]);
      wsMonth.getRow(rn).height = 30;
      rn += 1;
      const first = rn;
      for (const p of paid) {
        wsMonth.getRow(rn).values = [p.paidOn, p.borrower, p.ref, p.round, p.amount, p.profit, p.principal, p.timing];
        wsMonth.getCell(`A${rn}`).numFmt = DATE;
        for (const c of ["E", "F", "G"]) wsMonth.getCell(`${c}${rn}`).numFmt = MONEY;
        wsMonth.getCell(`F${rn}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROFIT_FILL } };
        if (p.timing.includes("late")) wsMonth.getCell(`H${rn}`).font = { color: { argb: "FFB91C1C" } };
        rn += 1;
      }
      wsMonth.getCell(`D${rn}`).value = "Total received";
      wsMonth.getCell(`E${rn}`).value = { formula: `SUM(E${first}:E${rn - 1})`, result: m.received };
      wsMonth.getCell(`F${rn}`).value = { formula: `SUM(F${first}:F${rn - 1})`, result: m.profit };
      wsMonth.getCell(`G${rn}`).value = { formula: `SUM(G${first}:G${rn - 1})`, result: m.principalBack };
      for (const c of ["E", "F", "G"]) wsMonth.getCell(`${c}${rn}`).numFmt = MONEY;
      wsMonth.getRow(rn).font = { bold: true };
      rn += 1;
    } else {
      wsMonth.getCell(`A${rn}`).value = "No payments received this month.";
      wsMonth.getCell(`A${rn}`).font = { italic: true, color: { argb: "FF64748B" } };
      rn += 1;
    }
    rn += 1;

    // Month result
    const res = wsMonth.getRow(rn);
    res.getCell(1).value = "Month result";
    res.getCell(2).value = `Profit earned: TSh ${m.profit.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    res.getCell(4).value = `Lent out: TSh ${m.lentOut.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    res.getCell(6).value = `Received: TSh ${m.received.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    for (let c = 1; c <= 8; c++) {
      res.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PROFIT_FILL } };
      res.getCell(c).font = { bold: true, color: { argb: "FF166534" } };
    }
    rn += 3;
  }

  buildPeopleSheet(wsPeople, r, sub);

  wsSum.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  wsPeople.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  wsMonth.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  wsLoans.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  wsPay.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// "By borrower" — who's who index, then one block per person
// ---------------------------------------------------------------------------

const TONE_FONT: Record<RoundLine["tone"], Partial<ExcelJS.Font>> = {
  ok: { color: { argb: "FF166534" } },
  late: { color: { argb: "FFB91C1C" } },
  overdue: { color: { argb: "FFB91C1C" }, bold: true },
  muted: { color: { argb: "FF94A3B8" }, italic: true },
  neutral: { color: { argb: "FF475569" } },
};

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function fmtTsh(v: number): string {
  return `TSh ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildPeopleSheet(ws: ExcelJS.Worksheet, r: BusinessReport, sub: string[]) {
  title(ws, "By borrower", [
    ...sub,
    "Everyone who borrowed or paid in this period, plus anyone who still owes. Each person's full loan history is shown. Click a name to jump to it.",
  ]);
  [16, 13, 15, 15, 13, 15, 15, 15, 44].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  if (r.people.length === 0) {
    ws.getCell("A6").value = "No borrowers to show for this period.";
    return;
  }

  // Work out where each person's block will start, so the index can link to it.
  const INDEX_HEAD = 6;
  let rn = INDEX_HEAD + r.people.length + 2 /* total row + gap */ + 2;
  const startRow: number[] = [];
  for (const person of r.people) {
    startRow.push(rn);
    rn += 2; // name band + summary line
    for (const loan of person.loans) rn += 1 + 1 + loan.lines.length + 1 + 1; // loan line, header, lines, total, gap
    rn += 1; // gap after person
  }

  // ---- Index
  headerRow(ws, INDEX_HEAD, [
    "Borrower", "Phone", "Loans", "Borrowed", "Paid back", "Profit (interest)",
    "Still owes", "Late payments", "Right now",
  ]);
  r.people.forEach((p, i) => {
    const row = ws.getRow(INDEX_HEAD + 1 + i);
    row.getCell(1).value = { text: p.name, hyperlink: `#'By borrower'!A${startRow[i]}` };
    row.getCell(1).font = { color: { argb: "FF1D4ED8" }, underline: true };
    row.getCell(2).value = p.phone;
    row.getCell(3).value = p.loans.length;
    row.getCell(4).value = p.borrowed;
    row.getCell(5).value = p.paid;
    row.getCell(6).value = p.profit;
    row.getCell(7).value = p.owes;
    row.getCell(8).value = p.latePayments;
    row.getCell(9).value = p.alert || (p.owes > 0 ? "Paying — nothing overdue" : "All paid up");
    row.getCell(9).font = p.alert ? TONE_FONT.overdue : TONE_FONT.ok;
    row.getCell(9).alignment = { horizontal: "left", indent: 1 };
    for (const c of [4, 5, 6, 7]) row.getCell(c).numFmt = MONEY;
    fill(row.getCell(6), PROFIT_FILL);
  });
  const idxLast = INDEX_HEAD + r.people.length;
  const tot = ws.getRow(idxLast + 1);
  tot.getCell(1).value = "TOTAL";
  const sums: Record<number, number> = {
    3: r.people.reduce((s, p) => s + p.loans.length, 0),
    4: r.people.reduce((s, p) => s + p.borrowed, 0),
    5: r.people.reduce((s, p) => s + p.paid, 0),
    6: r.people.reduce((s, p) => s + p.profit, 0),
    7: r.people.reduce((s, p) => s + p.owes, 0),
    8: r.people.reduce((s, p) => s + p.latePayments, 0),
  };
  for (const c of [3, 4, 5, 6, 7, 8]) {
    const C = colLetter(c);
    tot.getCell(c).value = { formula: `SUM(${C}${INDEX_HEAD + 1}:${C}${idxLast})`, result: sums[c] };
    if (c >= 4 && c <= 7) tot.getCell(c).numFmt = MONEY;
  }
  tot.font = { bold: true };
  for (let c = 1; c <= 9; c++) {
    fill(tot.getCell(c), BAND_FILL);
    tot.getCell(c).border = { top: { style: "thin" } };
  }

  // ---- One block per person
  r.people.forEach((p, i) => {
    let row = startRow[i];
    const band = ws.getRow(row);
    band.getCell(1).value = p.name.toUpperCase();
    band.getCell(3).value = p.phone;
    band.getCell(5).value = `Lendo Score ${p.score} (${p.band})`;
    band.getCell(7).value = p.referral ? `Referral: ${p.referral}` : "";
    for (let c = 1; c <= 9; c++) {
      fill(band.getCell(c), BRAND);
      band.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
    band.height = 20;
    row++;
    const summary = ws.getRow(row);
    summary.getCell(1).value =
      `${p.loans.length} loan(s) · Borrowed ${fmtTsh(p.borrowed)} · Paid back ${fmtTsh(p.paid)} · ` +
      `Profit from them ${fmtTsh(p.profit)} · Still owes ${fmtTsh(p.owes)} · Late payments: ${p.latePayments}` +
      (p.alert ? ` · ${p.alert}` : "");
    summary.getCell(1).font = p.alert ? TONE_FONT.overdue : { bold: true, color: { argb: "FF334155" } };
    row++;

    for (const loan of p.loans) {
      const head = ws.getRow(row);
      head.getCell(1).value =
        `Loan ${loan.ref} · Asked & given ${formatDate(loan.givenOn)} · ${fmtTsh(loan.amount)} · ` +
        `${loan.ratePct}% per round · ${loan.rounds} rounds · final due ${formatDate(loan.finalDue)} · ` +
        `${loan.status} · given by ${loan.givenBy}`;
      head.getCell(1).font = { bold: true };
      for (let c = 1; c <= 9; c++) fill(head.getCell(c), BAND_FILL);
      row++;

      headerRow(ws, row, [
        "Round", "Due date", "Balance at start", "Minimum due", "Paid on",
        "Amount paid", "Profit (interest)", "Principal", "Status",
      ]);
      ws.getRow(row).height = 18;
      row++;

      const first = row;
      for (const l of loan.lines) {
        const lr = ws.getRow(row);
        lr.values = [
          l.round, l.dueDate ?? null, l.opening, l.minimumDue, l.paidOn ?? null,
          l.paid, l.profit, l.principal, l.status,
        ];
        for (const c of [2, 5]) lr.getCell(c).numFmt = DATE;
        for (const c of [3, 4, 6, 7, 8]) lr.getCell(c).numFmt = MONEY;
        for (const c of [1, 2]) lr.getCell(c).alignment = { horizontal: "left" };
        lr.getCell(5).alignment = { horizontal: "left", indent: 1 };
        lr.getCell(9).alignment = { horizontal: "left", indent: 1 };
        lr.getCell(9).font = TONE_FONT[l.tone];
        if (l.profit != null) fill(lr.getCell(7), PROFIT_FILL);
        if (l.tone === "muted") for (const c of [1, 2]) lr.getCell(c).font = TONE_FONT.muted;
        row++;
      }

      const lt = ws.getRow(row);
      lt.getCell(5).value = "Loan total";
      for (const [c, v] of [[6, loan.totalPaid], [7, loan.profit], [8, loan.principalPaid]] as const) {
        const C = colLetter(c);
        lt.getCell(c).value = { formula: `SUM(${C}${first}:${C}${row - 1})`, result: v };
        lt.getCell(c).numFmt = MONEY;
      }
      lt.getCell(9).alignment = { horizontal: "left", indent: 1 };
      lt.getCell(9).value = loan.stillOwes > 0 ? `Still owes ${fmtTsh(loan.stillOwes)} today` : "Fully paid";
      lt.font = { bold: true };
      lt.getCell(9).font = loan.stillOwes > 0 ? { bold: true, color: { argb: "FFB45309" } } : { bold: true, color: { argb: "FF166534" } };
      for (let c = 5; c <= 9; c++) lt.getCell(c).border = { top: { style: "thin" } };
      row += 2;
    }
  });
}
