"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { logout } from "@/lib/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/role-labels";
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
    <div className="flex items-center gap-2">
      <Link
        href="/settings/profile"
        className="text-right leading-tight hover:opacity-80"
        title="My profile"
      >
        <div className="text-sm font-medium">{name ?? email}</div>
        <div className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</div>
      </Link>
      <Button asChild variant="outline" size="icon" title="My profile">
        <Link href="/settings/profile">
          <UserRound className="size-4" />
        </Link>
      </Button>
      <form action={logout}>
        <Button variant="outline" size="icon" type="submit" title="Sign out">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
