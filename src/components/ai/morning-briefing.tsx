"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBriefing } from "@/lib/actions/briefing-actions";
import type { BriefingLang } from "@/lib/ai/briefing";
import { cn } from "@/lib/utils";

const LANG_KEY = "lendo.briefing.lang";

export function MorningBriefing() {
  const [lang, setLang] = useState<BriefingLang>("en");
  const [text, setText] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(l: BriefingLang, refresh = false) {
    setError(null);
    start(async () => {
      const res = await getBriefing(l, refresh);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText(res.text);
      setAt(res.at);
    });
  }

  useEffect(() => {
    let saved: BriefingLang = "en";
    try {
      if (localStorage.getItem(LANG_KEY) === "sw") saved = "sw";
    } catch {}
    setLang(saved);
    load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchLang(l: BriefingLang) {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
    load(l);
  }

  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <Card className="mb-6 border-violet-200">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-violet-700" />
          {lang === "sw" ? "Muhtasari wa leo" : "Today's briefing"}
        </CardTitle>
        <div className="flex items-center gap-1">
          {(["en", "sw"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => switchLang(l)}
              disabled={pending}
              className={cn(
                "rounded px-2 py-0.5 text-xs",
                lang === l ? "bg-violet-100 font-medium text-violet-800" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {l === "en" ? "English" : "Kiswahili"}
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => load(lang, true)}
            disabled={pending}
            aria-label="Refresh briefing"
            title="Refresh with the latest records"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : !text ? (
          <p className="text-sm text-muted-foreground">Preparing today&apos;s briefing…</p>
        ) : (
          <>
            <ul className="space-y-1.5 text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-violet-700">•</span>
                  <span>{l.replace(/^[•\-*]\s*/, "").replace(/\*\*/g, "")}</span>
                </li>
              ))}
            </ul>
            {at ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Written by Lendo AI at{" "}
                {new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })}
                {" "}from Lendo&apos;s records. Tap refresh after recording new payments.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
