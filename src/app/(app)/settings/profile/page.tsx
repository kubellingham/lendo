import { requireUser } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/role-labels";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ChangePasswordForm } from "@/components/staff/change-password-form";

export default async function ProfilePage() {
  const me = await requireUser();
  return (
    <>
      <PageHeader
        title="My profile"
        leading={<Avatar name={me.name ?? me.email ?? "You"} size="lg" />}
        description={`${me.email ?? ""} · ${ROLE_LABELS[me.role]}`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
