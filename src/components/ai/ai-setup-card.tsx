import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown instead of a Lendo AI tool when no AIML API key is configured. */
export function AiSetupCard() {
  return (
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
          <li>Redeploy (Deployments → ⋯ → Redeploy).</li>
        </ol>
      </CardContent>
    </Card>
  );
}
