import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  buildBusinessWorkbook,
  gatherBusinessReport,
  monthsBetween,
  parseMonth,
} from "@/lib/excel-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reports/excel?from=2026-09&to=2026-11
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if ((session.user as { role?: string }).role === "DEMO_VIEWER") {
    return new NextResponse("Not available in demo mode", { status: 403 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const thisMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const from = parseMonth(url.searchParams.get("from")) ?? thisMonth;
  const to = parseMonth(url.searchParams.get("to")) ?? from;
  if (monthsBetween(from, to).length === 0) {
    return new NextResponse("The 'from' month must be before the 'to' month.", {
      status: 400,
    });
  }

  const report = await gatherBusinessReport(
    from,
    to,
    session.user.name || session.user.email || "Lendo",
  );
  const xlsx = await buildBusinessWorkbook(report);

  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Lendo-Business-Report-${report.fileLabel}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
