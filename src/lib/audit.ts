import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type Json = Prisma.InputJsonValue;

export interface AuditParams {
  actorId?: string | null;
  action: string; // e.g. "customer.create", "loan.issue", "payment.record"
  entity: string; // e.g. "Customer", "Loan"
  entityId: string;
  before?: Json;
  after?: Json;
}

/**
 * Append an immutable audit-log entry. Best-effort: a logging failure must
 * never break the underlying business operation, so errors are swallowed and
 * reported to the server console.
 */
export async function audit(params: AuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        beforeJson: params.before,
        afterJson: params.after,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", params.action, err);
  }
}
