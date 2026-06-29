import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Diagnostic endpoint: bypasses the form / RHF / server actions entirely
// and reports exactly which step of a customer save fails. Visit
// /api/debug/save-test as a logged-in user.
export async function GET() {
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = [];

  const record = async (
    step: string,
    fn: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      const detail = await fn();
      steps.push({ step, ok: true, detail });
      return true;
    } catch (err) {
      steps.push({
        step,
        ok: false,
        detail: {
          name: err instanceof Error ? err.name : "Error",
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,

          code: (err as { code?: string })?.code,

          cause:
            err instanceof Error && err.cause
              ? {

                  name: (err.cause as Error)?.name,

                  message: (err.cause as Error)?.message,
                }
              : undefined,
        },
      });
      return false;
    }
  };

  let session: { user?: { id?: string; email?: string; role?: string } } | null = null;
  await record("env DATABASE_URL present", async () => ({
    present: !!process.env.DATABASE_URL,
  }));

  await record("auth() session lookup", async () => {

    session = (await auth()) as any;
    return {
      hasSession: !!session,
      user: session?.user
        ? {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
          }
        : null,
    };
  });

  await record("db.user.count()", async () => ({ count: await db.user.count() }));
  await record("db.customer.count() (before insert)", async () => ({
    count: await db.customer.count(),
  }));

  let inserted: { id: string } | null = null;

  const userId = (session as any)?.user?.id ?? null;
  if (!userId) {
    steps.push({
      step: "db.customer.create",
      ok: false,
      detail: { skipped: true, reason: "no session.user.id" },
    });
  } else {
    await record("db.customer.create", async () => {
      inserted = await db.customer.create({
        data: {
          type: "INDIVIDUAL",
          fullName: `Debug Test ${new Date().toISOString()}`,
          phone: "+255700000000",
          addressLine: "Debug Address",
          city: "Dar es Salaam",
          region: "Dar es Salaam",
          createdById: userId,
        },
      });
      return { id: inserted.id };
    });
  }

  await record("db.customer.count() (after insert)", async () => ({
    count: await db.customer.count(),
  }));

  return NextResponse.json(
    { ok: steps.every((s) => s.ok), steps },
    { status: 200 },
  );
}
