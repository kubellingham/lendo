"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Key, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/role-labels";
import type { Role } from "@/generated/prisma/enums";
import {
  createUser,
  updateUser,
  resetUserPassword,
  setUserActive,
  deleteUser,
} from "@/lib/actions/user-actions";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "ADMIN", label: ROLE_LABELS.ADMIN },
  { value: "LOAN_OFFICER", label: ROLE_LABELS.LOAN_OFFICER },
  { value: "ACCOUNTANT", label: ROLE_LABELS.ACCOUNTANT },
];

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
};

export function AddStaffButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "LOAN_OFFICER" as Role,
    password: "",
  });

  function submit() {
    setError(null);
    start(async () => {
      const res = await createUser(form);
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        setForm({ name: "", email: "", role: "LOAN_OFFICER", password: "" });
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add staff
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Grace Mushi"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value.toLowerCase() })
                }
                placeholder="grace@lendo.co.tz"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as Role })
                }
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Initial password</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="8+ characters"
              />
              <p className="text-xs text-muted-foreground">
                Share this once with them (WhatsApp works) — they can change it
                from their profile after signing in.
              </p>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Adding…" : "Add staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StaffRowActions({
  user,
  isSelf,
}: {
  user: StaffUser;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, start] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: user.name, role: user.role });
  const [newPwd, setNewPwd] = useState("");

  function saveEdit() {
    setEditError(null);
    start(async () => {
      const res = await updateUser({ id: user.id, ...editForm });
      if (!res.ok) setEditError(res.error);
      else {
        setEditOpen(false);
        router.refresh();
      }
    });
  }

  function doReset() {
    setResetError(null);
    start(async () => {
      const res = await resetUserPassword(user.id, newPwd);
      if (!res.ok) setResetError(res.error);
      else {
        setResetOpen(false);
        setNewPwd("");
        alert(`Password reset for ${user.name}. Share the new password with them.`);
      }
    });
  }

  function toggle() {
    const next = !user.isActive;
    const msg = next
      ? `Reactivate ${user.name}?`
      : `Suspend ${user.name}? They'll be signed out and can't log in until reactivated.`;
    if (!confirm(msg)) return;
    start(async () => {
      const res = await setUserActive(user.id, next);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  function remove() {
    if (
      !confirm(
        `Permanently delete ${user.name}? Only works if they haven't recorded any work.`,
      )
    )
      return;
    start(async () => {
      const res = await deleteUser(user.id);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
        <Key className="size-4" /> Reset password
      </Button>
      {isSelf ? null : (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            disabled={pending}
            title={user.isActive ? "Suspend" : "Reactivate"}
          >
            {user.isActive ? (
              <>
                <Pause className="size-4" /> Suspend
              </>
            ) : (
              <>
                <Play className="size-4" /> Reactivate
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={pending}
            title="Delete"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {user.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={editForm.role}
                onChange={(e) =>
                  setEditForm({ ...editForm, role: e.target.value as Role })
                }
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {editError ? (
            <p className="text-sm text-destructive" role="alert">
              {editError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {user.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Set a new password and share it with them once. They can change it
              again from their profile after signing in.
            </p>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="8+ characters"
                autoFocus
              />
            </div>
          </div>
          {resetError ? (
            <p className="text-sm text-destructive" role="alert">
              {resetError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={doReset} disabled={pending}>
              {pending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
