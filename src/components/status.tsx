import { Badge } from "@/components/ui/badge";
import type {
  FlagSeverity,
  InstallmentStatus,
  LoanStatus,
  NotificationStatus,
} from "@/generated/prisma/enums";

type Variant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

const LOAN: Record<LoanStatus, { label: string; variant: Variant }> = {
  ACTIVE: { label: "Active", variant: "default" },
  SETTLED: { label: "Settled", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "warning" },
  DEFAULTED: { label: "Defaulted", variant: "destructive" },
  WRITTEN_OFF: { label: "Written off", variant: "secondary" },
};

const INSTALLMENT: Record<InstallmentStatus, { label: string; variant: Variant }> = {
  PENDING: { label: "Pending", variant: "outline" },
  INTEREST_PAID: { label: "Interest paid", variant: "default" },
  SETTLED: { label: "Settled", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "warning" },
};

const FLAG: Record<FlagSeverity, { label: string; variant: Variant }> = {
  LOW: { label: "Low", variant: "secondary" },
  MED: { label: "Medium", variant: "warning" },
  HIGH: { label: "High", variant: "warning" },
  BLACKLIST: { label: "Blacklist", variant: "destructive" },
};

const NOTIFICATION: Record<NotificationStatus, { label: string; variant: Variant }> = {
  QUEUED: { label: "Queued", variant: "outline" },
  SENT: { label: "Sent", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
};

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  const s = LOAN[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  const s = INSTALLMENT[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function FlagBadge({ severity }: { severity: FlagSeverity }) {
  const s = FLAG[severity];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  const s = NOTIFICATION[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
