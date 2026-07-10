"use client";

import { useState, useTransition } from "react";
import { createInvoice } from "./actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

type Props = {
  quoteId: string;
  quoteTotal: number;
};

export const CreateInvoiceForm = ({ quoteId, quoteTotal }: Props) => {
  const [invoiceType, setInvoiceType] = useState<"deposit" | "final">("final");
  const [amount, setAmount] = useState(quoteTotal.toFixed(2));
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ paymentUrl: string | null; delivered: boolean } | null>(
    null,
  );

  if (result) {
    return (
      <div className="text-sm text-success">
        Invoice created{result.delivered ? " and emailed." : "."}{" "}
        {result.paymentUrl && (
          <a href={result.paymentUrl} className="underline underline-offset-4">
            Payment link
          </a>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const res = await createInvoice({
            quoteId,
            invoiceType,
            amount: Number(amount),
            dueDate: dueDate || undefined,
          });
          setResult({ paymentUrl: res.paymentUrl, delivered: res.delivered });
        });
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        <Select
          label="Type"
          value={invoiceType}
          onChange={(e) => setInvoiceType(e.target.value as "deposit" | "final")}
        >
          <option value="final">Final</option>
          <option value="deposit">Deposit</option>
        </Select>
        <Input
          label="Amount (£)"
          type="number"
          step="0.01"
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
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Creating…" : "Create invoice"}
      </Button>
    </form>
  );
};
