import Link from "next/link";
import { requireUser } from "@/lib/rbac";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 border-b px-5 py-4"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            L
          </span>
          <span className="text-lg font-semibold">Lendo</span>
        </Link>
        <SidebarNav role={user.role} />
        <div className="mt-auto px-5 py-4 text-xs text-muted-foreground">
          TZS · Africa/Dar_es_Salaam
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-card px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav role={user.role} />
            <Link
              href="/dashboard"
              className="text-lg font-semibold md:hidden"
            >
              Lendo
            </Link>
          </div>
          <UserMenu name={user.name} email={user.email} role={user.role} />
        </header>
        <main className="flex-1 overflow-auto bg-canvas p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
