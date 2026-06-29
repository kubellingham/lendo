import type { Role } from "@/generated/prisma/enums";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  LOAN_OFFICER: "Loan Officer",
  ACCOUNTANT: "Accountant",
};
