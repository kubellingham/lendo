import { NextResponse } from "next/server";
import { checkBearer } from "@/lib/bearer";
import { loadEvelynSummary } from "@/lib/evelyn/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Read-only lending summary for Evelyn, the owner's assistant. Authenticated
 * with `Authorization: Bearer <EVELYN_API_SECRET>`; never writes anything.
 */
export async function GET(req: Request) {
  const access = checkBearer(
    req.headers.get("authorization"),
    process.env.EVELYN_API_SECRET,
  );
  if (access === "unconfigured") {
    return NextResponse.json(
      { error: "Not configured" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (access === "denied") {
    return NextResponse.json(
      { error: "Not authorised" },
      { status: 401, headers: NO_STORE },
    );
  }
  try {
    return NextResponse.json(await loadEvelynSummary(), { headers: NO_STORE });
  } catch (error) {
    console.error("Evelyn summary failed", error);
    return NextResponse.json(
      { error: "Couldn't build the summary" },
      { status: 500, headers: NO_STORE },
    );
  }
}
