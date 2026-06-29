import { requireUser } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name ?? "there"}`}
        description="Overview of lending activity."
      />
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Dashboard KPIs and charts arrive in a later phase.
        </CardContent>
      </Card>
    </>
  );
}
