"use client";

import { useMemo, useState, useTransition } from "react";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals } from "@/lib/quote-math";
import { updateQuoteLineItems, sendQuote } from "../actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        Quote
      </h2>
      <div className="flex flex-col gap-3">
        {lineItems.map((item, index) => (
          <Card key={index} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <input
                value={item.description}
                onChange={(e) =>
                  updateItem(index, { description: e.target.value })
                }
                className="flex-1 border-b border-transparent bg-transparent text-sm font-medium outline-none focus:border-border"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs text-text-muted hover:text-error"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                label="Qty"
                type="number"
                value={item.quantity}
                onChange={(e) =>
                  updateItem(index, { quantity: Number(e.target.value) })
                }
              />
              <Input
                label="Unit"
                value={item.unit}
                onChange={(e) => updateItem(index, { unit: e.target.value })}
              />
              <Input
                label="Unit price (£)"
                type="number"
                value={item.unit_price}
                onChange={(e) =>
                  updateItem(index, { unit_price: Number(e.target.value) })
                }
              />
            </div>
            {item.assumed && (
              <p className="text-xs text-warning">
                Assumed{item.assumption_note ? ` — ${item.assumption_note}` : ""}
                . Confirm before sending.
              </p>
            )}
          </Card>
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
        className="self-start text-sm text-text-secondary underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-current"
      >
        + Add line item
      </button>

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-text-secondary">Subtotal</span>
          <span className="tabular-nums">£{totals.subtotal.toFixed(2)}</span>
        </div>
        {vatRegistered && (
          <div className="flex justify-between">
            <span className="text-text-secondary">VAT (20%)</span>
            <span className="tabular-nums">£{totals.vat.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">£{totals.total.toFixed(2)}</span>
        </div>
      </div>

      <Button type="button" variant="secondary" onClick={save} disabled={isPending}>
        {isPending ? "Saving..." : saved ? "Saved" : "Save changes"}
      </Button>

      <Card className="flex flex-col gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Send to customer
        </h3>
        <Input
          label="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <Input
          label="Customer email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          type="email"
        />
        <Button
          type="button"
          onClick={send}
          disabled={isSending || !customerName || !customerEmail}
          className="self-start"
        >
          {isSending ? "Sending..." : "Send quote"}
        </Button>

        {sendResult && "error" in sendResult && (
          <p className="text-sm text-error">{sendResult.error}</p>
        )}
        {sendResult && "delivered" in sendResult && (
          <div className="text-sm text-text-secondary">
            {sendResult.delivered ? (
              <p>Quote emailed to {customerEmail}.</p>
            ) : (
              <p>
                Email isn&apos;t configured yet — share this link:{" "}
                <a href={sendResult.quoteUrl} className="text-accent underline underline-offset-4">
                  {sendResult.quoteUrl}
                </a>
              </p>
            )}
          </div>
        )}
      </Card>
    </section>
  );
};
