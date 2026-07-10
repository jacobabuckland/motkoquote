"use client";

import { useState, useTransition } from "react";
import { createInvoice } from "./actions";

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
      <div className="text-sm text-green-700">
        Invoice created{result.delivered ? " and emailed." : "."}{" "}
        {result.paymentUrl && (
          <a href={result.paymentUrl} className="underline">
            Payment link
          </a>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
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
      <div className="flex gap-2">
        <select
          value={invoiceType}
          onChange={(e) => setInvoiceType(e.target.value as "deposit" | "final")}
          className="border rounded-md px-2 py-1 text-sm"
        >
          <option value="final">Final</option>
          <option value="deposit">Deposit</option>
        </select>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm w-28"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="bg-black text-white rounded-md px-3 py-1.5 text-sm self-start disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create invoice"}
      </button>
    </form>
  );
};
