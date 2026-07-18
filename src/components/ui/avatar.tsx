import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-9 text-[13px]",
  lg: "size-14 text-xl",
} as const;

/**
 * Circular initials avatar, per the Lendo design system. `tone="danger"`
 * (flagged / overdue customers) renders in the red badge palette; the
 * default is a calm slate.
 */
export function Avatar({
  name,
  size = "md",
  tone = "default",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  tone?: "default" | "danger";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        tone === "danger"
          ? "bg-red-100 text-red-800"
          : "bg-slate-100 text-slate-700",
        className,
      )}
      aria-hidden
    >
      {initialsOf(name) || "?"}
    </span>
  );
}
