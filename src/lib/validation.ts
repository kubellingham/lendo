import { z } from "zod";
import {
  CustomerType,
  FlagSeverity,
  PaymentMethod,
  Role,
} from "@/generated/prisma/enums";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// E.164-ish phone: optional leading +, 7–15 digits.
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number (e.g. +255712345678)");

const optionalPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number")
  .optional()
  .or(z.literal(""));

const optionalText = z.string().trim().optional().or(z.literal(""));

export const customerSchema = z
  .object({
    type: z.nativeEnum(CustomerType),
    fullName: z.string().trim().min(2, "Full name is required"),
    businessName: optionalText,
    nationalIdNumber: optionalText,
    phone,
    altPhone: optionalPhone,
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
    addressLine: z.string().trim().min(2, "Address is required"),
    city: z.string().trim().min(1, "City is required"),
    region: z.string().trim().min(1, "Region is required"),
    occupation: optionalText,
    employer: optionalText,
    businessTin: optionalText,
    notes: optionalText,
  })
  .refine(
    (d) => d.type !== CustomerType.BUSINESS || !!d.businessName?.trim(),
    { message: "Business name is required for business customers", path: ["businessName"] },
  );
export type CustomerInput = z.infer<typeof customerSchema>;

export const loanSchema = z.object({
  customerId: z.string().min(1, "Select a customer"),
  principal: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,2})?$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  disbursedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a disbursal date"),
  // Admin-only override to issue to a blacklisted customer.
  overrideBlacklist: z.boolean().optional().default(false),
  overrideReason: optionalText,
});
export type LoanInput = z.infer<typeof loanSchema>;

export const paymentSchema = z.object({
  loanId: z.string().min(1),
  installmentId: z.string().optional().or(z.literal("")),
  amount: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,2})?$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a payment date"),
  method: z.nativeEnum(PaymentMethod),
  reference: optionalText,
  note: optionalText,
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const flagSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().trim().min(2, "Reason is required"),
  severity: z.nativeEnum(FlagSeverity),
});
export type FlagInput = z.infer<typeof flagSchema>;

export const userSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email("Invalid email"),
  role: z.nativeEnum(Role),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean().optional().default(true),
});
export type UserInput = z.infer<typeof userSchema>;
