"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal modal built on the native <dialog> element. No portal, no focus-trap
// library — sufficient for staff-only internal use. Accepts `open` and
// `onOpenChange` to integrate with React state.

type DialogContextValue = {
  ref: React.MutableRefObject<HTMLDialogElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <DialogContext.Provider value={{ ref, open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogContent must be inside Dialog");
  return (
    <dialog
      ref={ctx.ref}
      onClose={() => ctx.onOpenChange(false)}
      onClick={(e) => {
        // Close when clicking the backdrop.
        if (e.target === ctx.ref.current) ctx.onOpenChange(false);
      }}
      className={cn(
        "rounded-lg border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50 sm:max-w-lg w-[calc(100%-2rem)]",
        className,
      )}
    >
      <div className="p-4 sm:p-6 space-y-4">{children}</div>
    </dialog>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold leading-none tracking-tight">{children}</h2>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
