import Link from "next/link";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddReferralButton,
  EditReferralButton,
} from "@/components/referrals/referral-manager";

export default async function ReferralsPage() {
  const user = await requireUser();
  const canWrite = WRITE_ROLES.includes(user.role);

  const referrals = await db.referral.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { customers: true } },
      customers: {
        select: { id: true, fullName: true },
        take: 5,
        orderBy: { fullName: "asc" },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Referrals"
        description="Saved referee contacts you can attach to borrowers."
        action={canWrite ? <AddReferralButton /> : null}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Referred borrowers</TableHead>
                  {canWrite ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                    <TableCell>{r.relationship ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-medium">{r._count.customers}</span>
                      {r.customers.length > 0 ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.customers.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 ? ", " : ""}
                              <Link
                                href={`/customers/${c.id}`}
                                className="hover:underline"
                              >
                                {c.fullName}
                              </Link>
                            </span>
                          ))}
                          {r._count.customers > r.customers.length ? " …" : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="text-right">
                        <EditReferralButton
                          referral={{
                            id: r.id,
                            name: r.name,
                            phone: r.phone,
                            relationship: r.relationship,
                            notes: r.notes,
                          }}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
                {referrals.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canWrite ? 5 : 4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No referrals saved yet. Add one here, or add one while
                      editing a customer.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
