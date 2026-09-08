"use client";

// Customer-facing boundary for /i. Without it these routes fell through to
// src/app/error.tsx, whose copy is written for a signed-in contractor.
import { CustomerLinkError } from "@/components/customer/link-error";

export default function InvoiceLinkError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <CustomerLinkError error={error} reset={reset} document="invoice" />;
}
