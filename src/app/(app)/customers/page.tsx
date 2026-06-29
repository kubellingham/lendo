import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { Button } from "@/components/ui/button";
import {
  CustomersTable,
  type CustomerRow,
} from "@/components/customers/customers-table";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; flagged?: string }>;
}) {
  const user = await requireUser();
  const { q, flagged } = await searchParams;
  const canWrite = WRITE_ROLES.includes(user.role);

  const customers = await db.customer.findMany({
    where: {
      ...(flagged === "1" ? { isFlagged: true } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { businessName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { nationalIdNumber: { contains: q } },
            ],
          }
        : {}),
    },
    include: { loans: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    businessName: c.businessName,
    type: c.type,
    phone: c.phone,
    city: c.city,
    region: c.region,
    isFlagged: c.isFlagged,
    activeLoans: c.loans.filter((l) => l.status === "ACTIVE").length,
  }));

  return (
    <>
      <PageHeader
        title="Customers"
        description="Search and manage borrower records."
        action={
          canWrite ? (
            <Button asChild>
              <Link href="/customers/new">
                <Plus className="size-4" /> New customer
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Search by name, phone, ID…" />
        <Button
          asChild
          variant={flagged === "1" ? "default" : "outline"}
          size="sm"
        >
          <Link href={flagged === "1" ? "/customers" : "/customers?flagged=1"}>
            Flagged only
          </Link>
        </Button>
      </div>

      <CustomersTable rows={rows} />
    </>
  );
}
