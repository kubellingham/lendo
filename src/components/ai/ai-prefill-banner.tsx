import { Sparkles } from "lucide-react";

/** Shown on a form that Lendo AI filled in from a receipt. */
export function AiPrefillBanner() {
  return (
    <div className="flex gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">Filled in by Lendo AI from a receipt.</span>{" "}
        Check every
        detail against the receipt before saving — fix anything that&apos;s wrong.
      </p>
    </div>
  );
}
