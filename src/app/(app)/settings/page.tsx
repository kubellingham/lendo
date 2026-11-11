import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import {
  getBranding,
  getTitheRatePct,
  getPaymentDetails,
  setSetting,
  SETTING_KEYS,
} from "@/lib/settings";
import { LogoUpload } from "@/components/settings/logo-upload";
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
  const [titheRate, payment, brand] = await Promise.all([
    getTitheRatePct(),
    getPaymentDetails(),
    getBranding(),
  ]);

  async function saveBranding(formData: FormData) {
    "use server";
    const admin = await requireRole("ADMIN");
    const v = (k: string, max = 120) => String(formData.get(k) ?? "").trim().slice(0, max);
    const next = {
      name: v("brandName", 60) || "Lendo",
      tagline: v("brandTagline"),
      phone: v("brandPhone", 40),
      email: v("brandEmail", 80),
      town: v("brandTown", 80),
    };
    await Promise.all([
      setSetting(SETTING_KEYS.brandName, next.name),
      setSetting(SETTING_KEYS.brandTagline, next.tagline),
      setSetting(SETTING_KEYS.brandPhone, next.phone),
      setSetting(SETTING_KEYS.brandEmail, next.email),
      setSetting(SETTING_KEYS.brandTown, next.town),
    ]);
    await audit({
      actorId: admin.id,
      action: "settings.update",
      entity: "Setting",
      entityId: "branding",
      after: next,
    });
    revalidatePath("/settings");
    redirect("/settings?saved=1");
  }

  async function savePaymentDetails(formData: FormData) {
    "use server";
    const admin = await requireRole("ADMIN");
    const bank = String(formData.get("paymentBank") ?? "").trim();
    const accountName = String(formData.get("paymentAccountName") ?? "").trim();
    const accountNumber = String(
      formData.get("paymentAccountNumber") ?? "",
    ).trim();
    await Promise.all([
      setSetting(SETTING_KEYS.paymentBank, bank),
      setSetting(SETTING_KEYS.paymentAccountName, accountName),
      setSetting(SETTING_KEYS.paymentAccountNumber, accountNumber),
    ]);
    await audit({
      actorId: admin.id,
      action: "settings.update",
      entity: "Setting",
      entityId: "payment_details",
      after: { bank, accountName, accountNumber },
    });
    revalidatePath("/settings");
    redirect("/settings?saved=1");
  }

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

      <Card className="mb-6 max-w-xl">
        <CardHeader>
          <CardTitle>Branding on PDFs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Shown on receipts, statements, notices and reports. Empty fields are left off the PDF.
          </p>
          <LogoUpload current={brand.logo} name={brand.name} tagline={brand.tagline} />
          <form action={saveBranding} className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="brandName">Business name</Label>
                <Input id="brandName" name="brandName" defaultValue={brand.name} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brandTown">Town</Label>
                <Input id="brandTown" name="brandTown" defaultValue={brand.town} placeholder="Dodoma, Tanzania" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brandPhone">Phone</Label>
                <Input id="brandPhone" name="brandPhone" defaultValue={brand.phone} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brandEmail">Email</Label>
                <Input id="brandEmail" name="brandEmail" type="email" defaultValue={brand.email} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brandTagline">Tagline (under the name)</Label>
              <Input id="brandTagline" name="brandTagline" defaultValue={brand.tagline} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Save branding</Button>
              <Button asChild variant="outline">
                <a href="/api/branding/preview" target="_blank" rel="noopener noreferrer">
                  Preview a sample receipt
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6 max-w-xl">
        <CardHeader>
          <CardTitle>Staff</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Add and manage the people who can sign in to Lendo. Set roles,
            reset passwords, suspend or remove accounts.
          </p>
          <Button asChild variant="outline">
            <Link href="/settings/staff">Manage staff</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6 max-w-xl">
        <CardHeader>
          <CardTitle>Payment details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            These appear in every reminder and overdue message (WhatsApp text
            and PDF) so customers and referrals know exactly where to send the
            money. Change them once and every future message updates.
          </p>
          <form action={savePaymentDetails} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="paymentBank">Bank</Label>
              <Input
                id="paymentBank"
                name="paymentBank"
                defaultValue={payment.bank}
                placeholder="CRDB BANK"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentAccountName">Account name</Label>
              <Input
                id="paymentAccountName"
                name="paymentAccountName"
                defaultValue={payment.accountName}
                placeholder="Kathleen Kube"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentAccountNumber">Account number</Label>
              <Input
                id="paymentAccountNumber"
                name="paymentAccountNumber"
                defaultValue={payment.accountNumber}
                placeholder="10327855568"
              />
            </div>
            <Button type="submit">Save payment details</Button>
          </form>
        </CardContent>
      </Card>

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
