"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPassword } from "@/lib/actions/user-actions";

export function ChangePasswordForm() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function submit() {
    setError(null);
    setSuccess(false);
    if (form.next !== form.confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    start(async () => {
      const res = await changeOwnPassword(form.current, form.next);
      if (!res.ok) setError(res.error);
      else {
        setSuccess(true);
        setForm({ current: "", next: "", confirm: "" });
      }
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label>Current password</Label>
        <Input
          type="password"
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label>New password</Label>
        <Input
          type="password"
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
          placeholder="8+ characters"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Confirm new password</Label>
        <Input
          type="password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-700">Password updated.</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}
