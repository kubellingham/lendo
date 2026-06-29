"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Updates the `q` query-string param (debounced via a small form submit). */
export function SearchBox({ placeholder = "Search…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  function apply(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("q", next);
    else sp.delete("q");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  return (
    <form
      className="relative w-full max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        apply(value);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => apply(value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </form>
  );
}
