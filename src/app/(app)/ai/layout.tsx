import { redirect } from "next/navigation";
import { requireUser, WRITE_ROLES } from "@/lib/rbac";
import { AiTabs, type AiTab } from "@/components/ai/ai-tabs";

export default async function LendoAiLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === "DEMO_VIEWER") redirect("/dashboard?denied=1");
  const canWrite = WRITE_ROLES.includes(user.role);
  const tabs: AiTab[] = [
    ...(canWrite ? [{ href: "/ai", label: "Scan receipts" }] : []),
    { href: "/ai/statement", label: "Check statement" },
    { href: "/ai/ask", label: "Ask Lendo" },
  ];
  return (
    <>
      <AiTabs tabs={tabs} />
      {children}
    </>
  );
}
