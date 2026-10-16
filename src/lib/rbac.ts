import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@/generated/prisma/enums";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: Role;
};

/** Thrown by server actions when the caller lacks the required role. */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const sessionUser = (session?.user as SessionUser | undefined) ?? null;
  if (!sessionUser) return null;
  // Re-check the DB so a just-suspended or just-demoted user is bounced on
  // their next request, not only on next login (the JWT in their browser is
  // still valid otherwise).
  const live = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!live || !live.isActive) return null;
  return {
    id: live.id,
    name: live.name,
    email: live.email,
    role: live.role,
  };
}

/** For pages: ensure a logged-in user or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: ensure the user has one of the roles, else redirect. */
export async function requirePageRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (roles.length && !roles.includes(user.role)) {
    redirect("/dashboard?denied=1");
  }
  return user;
}

/**
 * For server actions: ensure the user has one of the roles, else throw.
 * Returns the acting user so callers can record `recordedById` etc.
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("You must be signed in.");
  if (roles.length && !roles.includes(user.role)) {
    throw new ForbiddenError();
  }
  return user;
}

export { ROLE_LABELS } from "@/lib/role-labels";

/** Roles permitted to mutate customers and issue loans / record payments. */
export const WRITE_ROLES: Role[] = [Role.ADMIN, Role.LOAN_OFFICER];
