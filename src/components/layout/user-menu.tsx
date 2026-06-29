"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";

export function UserMenu({
  name,
  email,
  role,
}: {
  name?: string | null;
  email?: string | null;
  role: Role;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="text-sm font-medium">{name ?? email}</div>
        <div className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</div>
      </div>
      <form action={logout}>
        <Button variant="outline" size="icon" type="submit" title="Sign out">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
