"use client";

import { useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveLogo } from "@/lib/actions/branding-actions";

const MAX_W = 600;
const MAX_H = 240;

/** Shrink to fit 600×240; PNG keeps transparency, JPEG if PNG is too big. */
async function prepare(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't open that image."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that image.");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");
    if (png.length < 600_000) return png;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LogoUpload({ current, name, tagline }: { current: string; name: string; tagline: string }) {
  const [logo, setLogo] = useState(current);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const shown = draft ?? logo;

  function save(value: string) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveLogo(value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLogo(value);
      setDraft(null);
      setSaved(true);
    });
  }

  return (
    <div className="space-y-3">
      {/* Preview of the PDF header band */}
      <div className="flex h-24 items-center gap-3 rounded-md bg-slate-900 px-4">
        {shown ? (
          <div className="flex h-14 items-center rounded bg-white px-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="Logo preview" className="max-h-11 max-w-[140px] object-contain" />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-xl font-bold tracking-wide text-white">{name.toUpperCase()}</div>
          <div className="truncate text-[11px] text-slate-400">{tagline}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">This is how the top of your receipts and statements looks.</p>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setError(null);
          setSaved(false);
          try {
            setDraft(await prepare(f));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={pending}>
          <ImageUp className="size-4" /> {logo || draft ? "Choose another logo" : "Upload logo"}
        </Button>
        {draft ? (
          <>
            <Button type="button" onClick={() => save(draft)} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save logo
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </Button>
          </>
        ) : logo ? (
          <Button type="button" variant="ghost" onClick={() => save("")} disabled={pending}>
            <Trash2 className="size-4" /> Remove logo
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {saved ? <p className="text-sm text-emerald-700">Logo saved. New PDFs will use it.</p> : null}
    </div>
  );
}
