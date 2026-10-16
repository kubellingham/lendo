"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole, requireUser, ForbiddenError } from "@/lib/rbac";
import { Role } from "@/generated/prisma/enums";

export type UserResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emailSchema = z.string().trim().toLowerCase().email("Invalid email");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");
const nameSchema = z.string().trim().min(2, "Name is required");

const createSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.nativeEnum(Role),
  password: passwordSchema,
});

export type CreateUserInput = z.infer<typeof createSchema>;

/** Count active admins. The "last admin" guard uses this. */
async function activeAdminCount(): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", isActive: true } });
}

/** Create a new staff member. ADMIN only. */
export async function createUser(input: CreateUserInput): Promise<UserResult> {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const d = parsed.data;
    const existing = await db.user.findUnique({ where: { email: d.email } });
    if (existing) {
      return { ok: false, error: "A user with that email already exists." };
    }
    const passwordHash = await bcrypt.hash(d.password, 10);
    const user = await db.user.create({
      data: {
        name: d.name,
        email: d.email,
        role: d.role,
        passwordHash,
        isActive: true,
      },
    });
    await audit({
      actorId: actor.id,
      action: "user.create",
      entity: "User",
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role },
    });
    revalidatePath("/settings/staff");
    return { ok: true, id: user.id };
  } catch (err) {
    console.error("[createUser]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create user.",
    };
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: nameSchema,
  role: z.nativeEnum(Role),
});

export async function updateUser(
  input: z.infer<typeof updateSchema>,
): Promise<UserResult> {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const d = parsed.data;
    const before = await db.user.findUnique({ where: { id: d.id } });
    if (!before) return { ok: false, error: "User not found." };

    // Guard: don't let the last active admin get demoted.
    if (
      before.role === "ADMIN" &&
      d.role !== "ADMIN" &&
      before.isActive &&
      (await activeAdminCount()) <= 1
    ) {
      return {
        ok: false,
        error:
          "Can't demote the last active administrator — add another admin first.",
      };
    }
    // Guard: an admin editing themselves can rename but can't demote themselves.
    if (actor.id === before.id && d.role !== "ADMIN" && before.role === "ADMIN") {
      return { ok: false, error: "You can't demote yourself." };
    }

    const user = await db.user.update({
      where: { id: d.id },
      data: { name: d.name, role: d.role },
    });
    await audit({
      actorId: actor.id,
      action: "user.update",
      entity: "User",
      entityId: user.id,
      before: { name: before.name, role: before.role },
      after: { name: user.name, role: user.role },
    });
    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${user.id}`);
    return { ok: true, id: user.id };
  } catch (err) {
    console.error("[updateUser]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update user.",
    };
  }
}

/** Suspend (isActive=false) or reactivate (isActive=true). */
export async function setUserActive(
  id: string,
  active: boolean,
): Promise<UserResult> {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }
    const before = await db.user.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "User not found." };
    if (!active && actor.id === before.id) {
      return { ok: false, error: "You can't suspend your own account." };
    }
    if (
      !active &&
      before.role === "ADMIN" &&
      before.isActive &&
      (await activeAdminCount()) <= 1
    ) {
      return {
        ok: false,
        error:
          "Can't suspend the last active administrator — add another admin first.",
      };
    }
    await db.user.update({ where: { id }, data: { isActive: active } });
    await audit({
      actorId: actor.id,
      action: active ? "user.activate" : "user.suspend",
      entity: "User",
      entityId: id,
    });
    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${id}`);
    return { ok: true, id };
  } catch (err) {
    console.error("[setUserActive]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update user.",
    };
  }
}

/** Admin resets another user's password. */
export async function resetUserPassword(
  id: string,
  newPassword: string,
): Promise<UserResult> {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };
    }
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return { ok: false, error: "User not found." };
    const passwordHash = await bcrypt.hash(parsed.data, 10);
    await db.user.update({ where: { id }, data: { passwordHash } });
    await audit({
      actorId: actor.id,
      action: "user.reset_password",
      entity: "User",
      entityId: id,
    });
    return { ok: true, id };
  } catch (err) {
    console.error("[resetUserPassword]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not reset password.",
    };
  }
}

/** User changes own password (must present current one). */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<UserResult> {
  try {
    const actor = await requireUser();
    const user = await db.user.findUnique({ where: { id: actor.id } });
    if (!user) return { ok: false, error: "User not found." };
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return { ok: false, error: "Current password is incorrect." };
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };
    }
    const passwordHash = await bcrypt.hash(parsed.data, 10);
    await db.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await audit({
      actorId: actor.id,
      action: "user.change_own_password",
      entity: "User",
      entityId: actor.id,
    });
    return { ok: true, id: actor.id };
  } catch (err) {
    console.error("[changeOwnPassword]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not change password.",
    };
  }
}

/**
 * Permanently delete a user. We only allow this when the user has no recorded
 * work (loans, payments, customers created, etc.) — otherwise suspend them
 * instead so their records keep correct attribution.
 */
export async function deleteUser(id: string): Promise<UserResult> {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (err) {
      if (err instanceof ForbiddenError)
        return { ok: false, error: err.message };
      throw err;
    }
    if (actor.id === id) {
      return { ok: false, error: "You can't delete your own account." };
    }
    const user = await db.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            customersCreated: true,
            loansIssued: true,
            paymentsRecorded: true,
            flagsCreated: true,
            referralsCreated: true,
          },
        },
      },
    });
    if (!user) return { ok: false, error: "User not found." };
    if (user.role === "ADMIN" && (await activeAdminCount()) <= 1) {
      return {
        ok: false,
        error:
          "Can't delete the last administrator — add another admin first.",
      };
    }
    const total =
      user._count.customersCreated +
      user._count.loansIssued +
      user._count.paymentsRecorded +
      user._count.flagsCreated +
      user._count.referralsCreated;
    if (total > 0) {
      return {
        ok: false,
        error:
          "This user has recorded work and can't be deleted (that would orphan their records). Suspend them instead to lock their account while keeping history intact.",
      };
    }
    await db.user.delete({ where: { id } });
    await audit({
      actorId: actor.id,
      action: "user.delete",
      entity: "User",
      entityId: id,
    });
    revalidatePath("/settings/staff");
    return { ok: true, id };
  } catch (err) {
    console.error("[deleteUser]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not delete user.",
    };
  }
}
