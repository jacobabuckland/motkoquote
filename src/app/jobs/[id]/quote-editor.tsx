"use client";

import { useMemo, useState, useTransition } from "react";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals } from "@/lib/quote-math";
import { updateQuoteLineItems, sendQuote } from "../actions";

type Props = {
  jobId: string;
  quoteId: string;
  initialLineItems: LineItem[];
  vatRegistered: boolean;
};

export const QuoteEditor = ({
  jobId,
  quoteId,
  initialLineItems,
  vatRegistered,
}: Props) => {
  const [lineItems, setLineItems] = useState<LineItem[]>(initialLineItems);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [isSending, startSending] = useTransition();
  const [sendResult, setSendResult] = useState<
    { delivered: boolean; quoteUrl: string } | { error: string } | null
  >(null);

  const totals = useMemo(
    () => computeQuoteTotals(lineItems, vatRegistered),
    [lineItems, vatRegistered],
  );

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setSaved(false);
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (index: number) => {
    setSaved(false);
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    startTransition(async () => {
      await updateQuoteLineItems({ jobId, quoteId, lineItems });
      setSaved(true);
    });
  };

  const send = () => {
    setSendResult(null);
    startSending(async () => {
      try {
        const result = await sendQuote({
          jobId,
          quoteId,
          customer: { name: customerName, email: customerEmail },
        });
        setSendResult(result);
      } catch (err) {
        setSendResult({
          error: err instanceof Error ? err.message : "Failed to send quote",
        });
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Quote</h2>
      <div className="flex flex-col gap-2">
        {lineItems.map((item, index) => (
          <div
            key={index}
            className="border rounded-md p-3 flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-2">
              <input
                value={item.description}
                onChange={(e) =>
                  updateItem(index, { description: e.target.value })
                }
                className="flex-1 text-sm font-medium border-b border-transparent focus:border-neutral-300 outline-none"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs text-neutral-400"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-neutral-500 flex flex-col gap-1">
                Qty
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) =>
                    updateItem(index, { quantity: Number(e.target.value) })
                  }
                  className="border rounded-md px-2 py-1 text-sm text-black"
                />
              </label>
              <label className="text-xs text-neutral-500 flex flex-col gap-1">
                Unit
                <input
                  value={item.unit}
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                  className="border rounded-md px-2 py-1 text-sm text-black"
                />
              </label>
              <label className="text-xs text-neutral-500 flex flex-col gap-1">
                Unit price (£)
                <input
                  type="number"
                  value={item.unit_price}
                  onChange={(e) =>
                    updateItem(index, { unit_price: Number(e.target.value) })
                  }
                  className="border rounded-md px-2 py-1 text-sm text-black"
                />
              </label>
            </div>
            {item.assumed && (
              <p className="text-xs text-amber-600">
                Assumed{item.assumption_note ? ` — ${item.assumption_note}` : ""}
                . Confirm before sending.
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setLineItems((prev) => [
            ...prev,
            {
              description: "",
              category: "other",
              quantity: 1,
              unit: "item",
              unit_price: 0,
              assumed: false,
            },
          ])
        }
        className="text-sm underline self-start"
      >
        + Add line item
      </button>

      <div className="border-t pt-3 flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>£{totals.subtotal.toFixed(2)}</span>
        </div>
        {vatRegistered && (
          <div className="flex justify-between">
            <span>VAT (20%)</span>
            <span>£{totals.vat.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-medium">
          <span>Total</span>
          <span>£{totals.total.toFixed(2)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="bg-black text-white rounded-md px-4 py-2 text-sm disabled:opacity-50"
      >
        {isPending ? "Saving..." : saved ? "Saved" : "Save changes"}
      </button>

      <div className="border-t pt-3 flex flex-col gap-2">
        <h3 className="font-medium text-sm">Send to customer</h3>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Customer name"
          className="border rounded-md px-2 py-1 text-sm text-black"
        />
        <input
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="Customer email"
          type="email"
          className="border rounded-md px-2 py-1 text-sm text-black"
        />
        <button
          type="button"
          onClick={send}
          disabled={isSending || !customerName || !customerEmail}
          className="bg-black text-white rounded-md px-4 py-2 text-sm disabled:opacity-50 self-start"
        >
          {isSending ? "Sending..." : "Send quote"}
        </button>

        {sendResult && "error" in sendResult && (
          <p className="text-sm text-red-600">{sendResult.error}</p>
        )}
        {sendResult && "delivered" in sendResult && (
          <div className="text-sm text-neutral-600">
            {sendResult.delivered ? (
              <p>Quote emailed to {customerEmail}.</p>
            ) : (
              <p>
                Email isn&apos;t configured yet — share this link:{" "}
                <a href={sendResult.quoteUrl} className="underline">
                  {sendResult.quoteUrl}
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
