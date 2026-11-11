import { requirePageRole, WRITE_ROLES } from "@/lib/rbac";
import { aiConfigured } from "@/lib/ai/receipt-ai";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReceiptScanner } from "@/components/ai/receipt-scanner";

export default async function LendoAiPage() {
  await requirePageRole(...WRITE_ROLES);

  return (
    <>
      <PageHeader
        title="Lendo AI · Scan receipt"
        description="Upload a bank or M-Pesa receipt. Lendo AI reads it, finds the customer and fills in the form — you check and approve."
      />
      {aiConfigured() ? (
        <ReceiptScanner />
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Lendo AI isn&apos;t switched on yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>It needs an AIML API key. One-time setup:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Sign in at <span className="font-medium">aimlapi.com</span>, open{" "}
                <span className="font-medium">Key Management</span> and create a key.
              </li>
              <li>
                In Vercel, open the Lendo project → <span className="font-medium">Settings → Environment Variables</span>.
              </li>
              <li>
                Add <code className="rounded bg-muted px-1">AIMLAPI_API_KEY</code> with the key as its value, for
                Production.
              </li>
              <li>Redeploy (Deployments → ⋯ → Redeploy). This page then turns on.</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </>
  );
}
