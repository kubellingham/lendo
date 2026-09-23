import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EditReferralButton } from "@/components/referrals/referral-manager";
import {
  CustomerToggleList,
  type ToggleCustomer,
} from "@/components/referrals/customer-toggle-list";

export default async function ReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const [referral, customers] = await Promise.all([
    db.referral.findUnique({ where: { id } }),
    db.customer.findMany({
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        phone: true,
        referralId: true,
        referral: { select: { name: true } },
      },
    }),
  ]);
  if (!referral) notFound();

  const list: ToggleCustomer[] = customers.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    phone: c.phone,
    currentReferralId: c.referralId,
    currentReferralName: c.referral?.name ?? null,
  }));

  return (
    <>
      <div className="mb-3">
        <Link
          href="/referrals"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All referrals
        </Link>
      </div>

      <PageHeader
        title={referral.name}
        leading={<Avatar name={referral.name} size="lg" />}
        description={
          <span className="font-mono text-xs">
            {referral.phone}
            {referral.relationship ? ` · ${referral.relationship}` : ""}
          </span>
        }
        action={
          <EditReferralButton
            referral={{
              id: referral.id,
              name: referral.name,
              phone: referral.phone,
              relationship: referral.relationship,
              notes: referral.notes,
            }}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Toggle on for each customer this referral vouches for. Reassignment
            from another referral will ask for confirmation.
          </p>
          <CustomerToggleList
            referralId={referral.id}
            referralName={referral.name}
            customers={list}
          />
        </CardContent>
      </Card>
    </>
  );
}
