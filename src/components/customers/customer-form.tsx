"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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

export function CustomerForm({
  customerId,
  defaultValues,
}: {
  customerId?: string;
  defaultValues?: Partial<CustomerInput>;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      type: "INDIVIDUAL",
      fullName: "",
      phone: "",
      addressLine: "",
      city: "",
      region: "",
      ...defaultValues,
    },
  });

  const type = watch("type");

  async function onSubmit(values: CustomerInput) {
    setFormError(null);
    const res: ActionResult = customerId
      ? await updateCustomer(customerId, values)
      : await createCustomer(values);
    // On success the action redirects; we only reach here on failure.
    if (!res.ok) setFormError(res.error);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
            <Input {...register("email")} type="email" />
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
