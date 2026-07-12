"use client";

import { useState, useTransition } from "react";
import { createInvoice } from "./actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { InlineLink } from "@/components/ui/inline-link";

type Props = {
  quoteId: string;
  quoteTotal: number;
};

export const CreateInvoiceForm = ({ quoteId, quoteTotal }: Props) => {
  const [invoiceType, setInvoiceType] = useState<"deposit" | "final">("final");
  const [amount, setAmount] = useState(quoteTotal.toFixed(2));
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paymentUrl: string | null; delivered: boolean } | null>(
    null,
  );

  if (result) {
    return (
      <div className="text-sm text-success">
        {result.delivered
          ? "Invoice sent to your customer."
          : "Invoice created — copy the payment link and send it over."}{" "}
        {result.paymentUrl && (
          <InlineLink href={result.paymentUrl} external>
            Payment link
          </InlineLink>
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
