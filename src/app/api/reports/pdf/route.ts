import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildReportData, type PeriodSpec, type PeriodType } from "@/lib/reporting";
import { buildReportPdf } from "@/lib/pdf/report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "month") as PeriodType;
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getUTCFullYear();
  const month = Number(url.searchParams.get("month")) || now.getUTCMonth() + 1;
  const quarter =
    Number(url.searchParams.get("quarter")) ||
    Math.floor(now.getUTCMonth() / 3) + 1;

  if (!["month", "quarter", "year"].includes(type)) {
    return new NextResponse("Bad period type", { status: 400 });
  }

  const spec: PeriodSpec = { type, year, month, quarter };
  const data = await buildReportData(spec);
  const pdf = await buildReportPdf(data);

  const safe = data.label.replace(/\s+/g, "-");
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Lendo-Report-${safe}.pdf"`,
    },
  });
}
