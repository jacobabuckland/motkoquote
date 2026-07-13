import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

// Phone and address are optional individually, but the refine below
// requires at least one contact channel (email or phone) — a quote can't
// actually be delivered to a customer with neither. Address is captured
// when known (usually via the voice SoW call) but never required, since
// a job's site address doesn't always differ from a billing address the
// contractor may not have bothered stating twice.
export const customerInputSchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.preprocess(emptyToUndefined, z.string().trim().email().optional()),
    phone: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    address: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: "Add at least an email or a mobile number for the customer",
    path: ["email"],
  });

export type CustomerInput = z.infer<typeof customerInputSchema>;
