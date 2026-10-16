import { requireRole } from "@/lib/rbac";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/role-labels";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddStaffButton,
  StaffRowActions,
} from "@/components/staff/staff-manager";

export default async function StaffPage() {
  const me = await requireRole("ADMIN");

  const users = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          customersCreated: true,
          loansIssued: true,
          paymentsRecorded: true,
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Staff"
        description="People who can sign in to Lendo. Add, suspend, or reset passwords here."
        action={<AddStaffButton />}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const activity = `${u._count.loansIssued} loan${u._count.loansIssued === 1 ? "" : "s"} · ${u._count.paymentsRecorded} payment${u._count.paymentsRecorded === 1 ? "" : "s"} · ${u._count.customersCreated} customer${u._count.customersCreated === 1 ? "" : "s"}`;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} size="sm" />
                          <div>
                            <div className="font-medium">
                              {u.name}
                              {u.id === me.id ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (you)
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{ROLE_LABELS[u.role]}</Badge>
                      </TableCell>
                      <TableCell>
                        {u.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="warning">Suspended</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {activity}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <StaffRowActions
                          user={{
                            id: u.id,
                            name: u.name,
                            email: u.email,
                            role: u.role,
                            isActive: u.isActive,
                          }}
                          isSelf={u.id === me.id}
                          inviterName={me.name ?? me.email}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No staff yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Every change to a staff member — add, edit, suspend, reset password,
        delete — is written to the audit log. The last active administrator
        can&apos;t be suspended, demoted or deleted (that would lock you out).
      </p>
    </>
  );
}
