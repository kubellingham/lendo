import { prisma } from './db';

type AuditInput = {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

export async function audit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,

        beforeJson: input.before ? (JSON.parse(JSON.stringify(input.before)) as any) : null,

        afterJson: input.after ? (JSON.parse(JSON.stringify(input.after)) as any) : null,
      },
    });
  } catch (err) {

    console.error('Failed to write audit log', err);
  }
}
