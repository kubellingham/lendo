import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatTZS } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoanStatusBadge, FlagBadge } from "@/components/status";
import { FlagControls } from "@/components/customers/flag-controls";
import { SendMessage } from "@/components/messaging/send-message";
import { Avatar } from "@/components/ui/avatar";

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const canWrite = WRITE_ROLES.includes(user.role);

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      loans: { orderBy: { createdAt: "desc" } },
      flags: {
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!customer) notFound();

  return (
    <>
      <PageHeader
        title={customer.fullName}
        leading={
          <Avatar
            name={customer.fullName}
            size="lg"
            tone={customer.isFlagged ? "danger" : "default"}
          />
        }
        description={
          customer.businessName ?? (customer.type === "BUSINESS" ? "Business" : "Individual")
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {customer.isFlagged ? (
              <Badge variant="destructive">{customer.flagReason ?? "Flagged"}</Badge>
            ) : null}
            <SendMessage
              context={{ kind: "customer", customerId: customer.id }}
              triggerLabel="Message"
            />
            {canWrite ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/customers/${customer.id}/edit`}>
                    <Pencil className="size-4" /> Edit
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/loans/new?customerId=${customer.id}`}>
                    <Plus className="size-4" /> Issue loan
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Phone" value={customer.phone} />
                <Detail label="Alternate phone" value={customer.altPhone} />
                <Detail label="Email" value={customer.email} />
                <Detail label="National ID" value={customer.nationalIdNumber} />
                <Detail label="Occupation" value={customer.occupation} />
                <Detail label="Employer" value={customer.employer} />
                <Detail label="Business TIN" value={customer.businessTin} />
                <Detail label="Address" value={customer.addressLine} />
                <Detail
                  label="Location"
                  value={`${customer.city}, ${customer.region}`}
                />
                <Detail
                  label="Referral"
                  value={
                    customer.referralName
                      ? `${customer.referralName}${customer.referralRelationship ? ` (${customer.referralRelationship})` : ""}`
                      : null
                  }
                />
                <Detail label="Referral phone" value={customer.referralPhone} />
              </dl>
              {customer.notes ? (
                <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                  {customer.notes}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loans ({customer.loans.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {customer.loans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No loans yet.</p>
              ) : (
                customer.loans.map((loan) => (
                  <Link
                    key={loan.id}
                    href={`/loans/${loan.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-accent"
                  >
                    <div>
                      <div className="font-medium">
                        {formatTZS(loan.principal.toString())}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Disbursed {formatDate(loan.disbursedAt)} · Due{" "}
                        {formatDate(loan.dueAt)}
                      </div>
                    </div>
                    <LoanStatusBadge status={loan.status} />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Risk flag</CardTitle>
              </CardHeader>
              <CardContent>
                <FlagControls
                  customerId={customer.id}
                  isFlagged={customer.isFlagged}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Flag history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer.flags.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No flags recorded.
                </p>
              ) : (
                customer.flags.map((f) => (
                  <div key={f.id} className="border-b pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <FlagBadge severity={f.severity} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(f.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{f.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      by {f.createdBy.name}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
