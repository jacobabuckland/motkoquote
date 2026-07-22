import { z } from "zod";

// The trade's own bank account, where pay-by-bank payments land directly (no
// merchant account, no payout step — see the direct-to-trade settlement model).
// Sort code and account number are stripped of spaces/hyphens before validating
// so a trade can type "12-34-56" naturally; the shapes mirror the DB check
// constraints on contractors (migration 00000000000024_payout_beneficiary.sql).
const digits = (value: string) => value.replace(/[\s-]/g, "");

export const payoutDetailsSchema = z.object({
  account_holder_name: z.string().trim().min(1, "Enter the account holder's name"),
  sort_code: z
    .string()
    .transform(digits)
    .pipe(z.string().regex(/^[0-9]{6}$/, "Sort code must be 6 digits")),
  account_number: z
    .string()
    .transform(digits)
    .pipe(z.string().regex(/^[0-9]{8}$/, "Account number must be 8 digits")),
});

export type PayoutDetailsInput = z.infer<typeof payoutDetailsSchema>;
