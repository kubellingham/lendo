import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import {
  getTitheRatePct,
  setSetting,
  SETTING_KEYS,
} from "@/lib/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const titheRate = await getTitheRatePct();

  async function saveTitheRate(formData: FormData) {
    "use server";
    const admin = await requireRole("ADMIN");
    const raw = Number(formData.get("titheRate"));
    const pct = Number.isFinite(raw)
      ? Math.min(100, Math.max(0, Math.round(raw)))
      : 10;
    await setSetting(SETTING_KEYS.titheRatePct, String(pct));
    await audit({
      actorId: admin.id,
      action: "settings.update",
      entity: "Setting",
      entityId: SETTING_KEYS.titheRatePct,
      after: { titheRatePct: pct },
    });
    revalidatePath("/settings");
    revalidatePath("/tithes");
    redirect("/settings?saved=1");
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure how Lendo behaves."
      />

      {sp.saved ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Settings saved.
        </div>
      ) : null}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Tithes</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveTitheRate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="titheRate">Tithe rate (% of interest earned)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="titheRate"
                  name="titheRate"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={titheRate}
                  className="max-w-28"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Applied to the interest (profit) collected each month on the
                Tithes page. Currently {titheRate}%.
              </p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
