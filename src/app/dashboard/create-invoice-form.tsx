"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "./actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { InlineLink } from "@/components/ui/inline-link";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

type Props = {
  quoteId: string;
  quoteTotal: number;
  jobId?: string;
  customerName?: string;
};

export const CreateInvoiceForm = ({ quoteId, quoteTotal, jobId, customerName }: Props) => {
  const router = useRouter();
  const [invoiceType, setInvoiceType] = useState<"deposit" | "final">("final");
  const [amount, setAmount] = useState(quoteTotal.toFixed(2));
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paymentUrl: string | null; delivered: boolean } | null>(
    null,
  );

  if (result) {
    const name = customerName ?? "your customer";
    if (result.delivered) {
      return (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-success">Invoice sent to {name} (email).</p>
          <p className="text-text-secondary">
            They can pay online through the link. We&apos;ll email you when the payment lands.
            Nothing else needs you until then.
          </p>
          {result.paymentUrl && <CopyLinkButton url={result.paymentUrl} label="Copy payment link" />}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-text-secondary">
          Invoice created, but there&apos;s no way to email {name} — copy the payment link and
          send it over yourself.
        </p>
        {result.paymentUrl && (
          <div className="flex flex-wrap items-center gap-3">
            <InlineLink href={result.paymentUrl} external>
              Payment link
            </InlineLink>
            <CopyLinkButton url={result.paymentUrl} label="Copy payment link" />
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const res = await createInvoice({
              quoteId,
              invoiceType,
              amount: Number(amount),
              dueDate: dueDate || undefined,
            });
            // Delivered cleanly → hand off to the job hub's celebratory
            // state. The server action already revalidated the job/dashboard
            // data, so a single push lands on fresh RSC. (router.refresh() here
            // races the push and wedges the transition on "Sending…".)
            // Otherwise stay put so the payment link stays visible.
            if (res.delivered && jobId) {
              router.push(`/jobs/${jobId}?sent=invoice`);
              return;
            }
            setResult({ paymentUrl: res.paymentUrl, delivered: res.delivered });
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't create the invoice — try again.",
            );
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          label="Type"
          value={invoiceType}
          onChange={(e) => setInvoiceType(e.target.value as "deposit" | "final")}
        >
          <option value="final">Final invoice</option>
          <option value="deposit">Deposit</option>
        </Select>
        <Input
          label="Amount (£)"
          type="number"
          inputMode="decimal"
          step="0.01"
          className="tabular-nums"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Sending…" : "Send invoice"}
      </Button>
    </form>
  );
};
