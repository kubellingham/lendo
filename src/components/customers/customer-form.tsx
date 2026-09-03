"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { customerSchema, type CustomerInput } from "@/lib/validation";
import {
  createCustomer,
  updateCustomer,
  type ActionResult,
} from "@/lib/actions/customer-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export type ReferralOption = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
};

export function CustomerForm({
  customerId,
  defaultValues,
  referrals = [],
}: {
  customerId?: string;
  defaultValues?: Partial<CustomerInput>;
  referrals?: ReferralOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return") || undefined;
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      type: "INDIVIDUAL",
      fullName: "",
      phone: "",
      addressLine: "",
      city: "Dar es Salaam",
      region: "Dar es Salaam",
      email: "",
      businessName: "",
      businessTin: "",
      nationalIdNumber: "",
      altPhone: "",
      occupation: "",
      employer: "",
      notes: "",
      referralId: "",
      referralName: "",
      referralPhone: "",
      referralRelationship: "",
      ...defaultValues,
    },
  });

  const type = watch("type");

  async function onSubmit(values: CustomerInput) {
    setFormError(null);
    try {
      const res: ActionResult = customerId
        ? await updateCustomer(customerId, values)
        : await createCustomer(values, returnTo);
      if (res.ok) {
        if (res.redirectTo) router.push(res.redirectTo);
        return;
      }
      setFormError(res.error);
      if (res.fieldErrors) {
        for (const [name, msgs] of Object.entries(res.fieldErrors)) {
          if (msgs && msgs.length) {
            setError(name as keyof CustomerInput, { type: "server", message: msgs[0] });
          }
        }
      }
    } catch (err) {
      console.error("[customer-form] submit error", err);
      setFormError(
        err instanceof Error
          ? `Save failed: ${err.message}`
          : "Save failed (unknown error). Check your connection and try again.",
      );
    }
  }

  const errorList = Object.entries(errors)
    .map(([k, v]) => [k, (v as { message?: string })?.message] as const)
    .filter(([, msg]) => !!msg);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {errorList.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive mb-1">
            Please fix these fields:
          </p>
          <ul className="list-disc list-inside text-destructive">
            {errorList.map(([k, msg]) => (
              <li key={k}>
                <span className="font-medium">{k}:</span> {msg}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field label="Customer type" error={errors.type?.message}>
            <Select {...register("type")}>
              <option value="INDIVIDUAL">Individual</option>
              <option value="BUSINESS">Business</option>
            </Select>
          </Field>
          <Field label="Full name" error={errors.fullName?.message}>
            <Input {...register("fullName")} placeholder="Jane Doe" />
          </Field>
          {type === "BUSINESS" ? (
            <>
              <Field label="Business name" error={errors.businessName?.message}>
                <Input {...register("businessName")} />
              </Field>
              <Field label="Business TIN" error={errors.businessTin?.message}>
                <Input {...register("businessTin")} />
              </Field>
            </>
          ) : (
            <Field
              label="National ID number"
              error={errors.nationalIdNumber?.message}
            >
              <Input {...register("nationalIdNumber")} />
            </Field>
          )}
          <Field label="Phone (E.164)" error={errors.phone?.message}>
            <Input {...register("phone")} placeholder="+255712345678" />
          </Field>
          <Field label="Alternate phone" error={errors.altPhone?.message}>
            <Input {...register("altPhone")} placeholder="+255…" />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <Input {...register("email")} placeholder="optional" />
          </Field>
          <Field label="Occupation" error={errors.occupation?.message}>
            <Input {...register("occupation")} />
          </Field>
          <Field label="Employer" error={errors.employer?.message}>
            <Input {...register("employer")} />
          </Field>
          <Field label="Address" error={errors.addressLine?.message}>
            <Input {...register("addressLine")} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input {...register("city")} />
          </Field>
          <Field label="Region" error={errors.region?.message}>
            <Input {...register("region")} />
          </Field>

          <div className="sm:col-span-2 mt-1 border-t pt-3 text-sm font-medium text-muted-foreground">
            Referral / referee (optional)
          </div>
          <div className="sm:col-span-2">
            <Field label="Use a saved referral" error={errors.referralId?.message}>
              <Select {...register("referralId")}>
                <option value="">— None / add a new one below —</option>
                {referrals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.phone}
                    {r.relationship ? ` (${r.relationship})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!watch("referralId") ? (
            <>
              <Field label="New referral name" error={errors.referralName?.message}>
                <Input
                  {...register("referralName")}
                  placeholder="e.g. Violet Mushi"
                />
              </Field>
              <Field
                label="New referral phone"
                error={errors.referralPhone?.message}
              >
                <Input {...register("referralPhone")} placeholder="+255…" />
              </Field>
              <Field
                label="Relationship"
                error={errors.referralRelationship?.message}
              >
                <Input
                  {...register("referralRelationship")}
                  placeholder="e.g. Aunt, employer, friend"
                />
              </Field>
            </>
          ) : null}

          <div className="sm:col-span-2">
            <Field label="Notes" error={errors.notes?.message}>
              <Textarea {...register("notes")} rows={3} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? "Saving…"
            : customerId
              ? "Save changes"
              : "Create customer"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
