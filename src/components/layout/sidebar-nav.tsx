"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Banknote,
  Receipt,
  BarChart3,
  HandCoins,
  Landmark,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/generated/prisma/enums";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[]; // if set, only these roles see the item
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/loans", label: "Loans", icon: Banknote },
  { href: "/payments", label: "Payments", icon: Receipt },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  {
    href: "/capital",
    label: "Capital",
    icon: Landmark,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/tithes",
    label: "Tithes",
    icon: HandCoins,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["ADMIN"] },
];

export function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.filter((item) => !item.roles || item.roles.includes(role)).map(
        (item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        },
      )}
    </nav>
  );
}
