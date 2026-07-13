"use client";

import { useMemo, useState, useTransition } from "react";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals } from "@/lib/quote-math";
import { updateQuoteLineItems, sendQuote } from "../actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineLink } from "@/components/ui/inline-link";

type Props = {
  jobId: string;
  quoteId: string;
  initialLineItems: LineItem[];
  vatRegistered: boolean;
  initialCustomerName?: string;
  initialCustomerEmail?: string;
  initialCustomerPhone?: string;
  initialSiteAddress?: string;
};

export const QuoteEditor = ({
  jobId,
  quoteId,
  initialLineItems,
  vatRegistered,
  initialCustomerName,
  initialCustomerEmail,
  initialCustomerPhone,
  initialSiteAddress,
}: Props) => {
  // Legacy quotes drafted before the multiplier field existed have it
  // genuinely missing at runtime (line_items_json is loaded via a type
  // cast, not zod parsing) — normalize on the way into state so the input
  // shows 1 instead of blank.
  const [lineItems, setLineItems] = useState<LineItem[]>(() =>
    initialLineItems.map((item) => ({ ...item, multiplier: item.multiplier ?? 1 })),
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Pre-filled from whatever the contractor mentioned during the voice
  // call (see sow.customer_name etc.) — still editable/correctable here,
  // never auto-sent without a human reviewing it first.
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone ?? "");
  const [siteAddress, setSiteAddress] = useState(initialSiteAddress ?? "");
  const [isSending, startSending] = useTransition();
  const hasContactChannel = Boolean(customerEmail.trim() || customerPhone.trim());
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
          customer: {
            name: customerName,
            email: customerEmail || undefined,
            phone: customerPhone || undefined,
            address: siteAddress || undefined,
          },
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
                aria-label={`Line item ${index + 1} description`}
                value={item.description}
                onChange={(e) =>
                  updateItem(index, { description: e.target.value })
                }
                className="flex-1 rounded-control border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-border"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="inline-flex min-h-11 shrink-0 items-center px-1 text-xs font-medium text-text-muted hover:text-error"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              <Input
                label="Multiplier"
                type="number"
                step="0.1"
                value={item.multiplier}
                onChange={(e) =>
                  updateItem(index, { multiplier: Number(e.target.value) })
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

      <Button
        type="button"
        variant="tertiary"
        className="self-start"
        onClick={() =>
          setLineItems((prev) => [
            ...prev,
            {
              description: "",
              category: "other",
              quantity: 1,
              unit: "item",
              unit_price: 0,
              multiplier: 1,
              assumed: false,
            },
          ])
        }
      >
        + Add line item
      </Button>

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
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold tabular-nums">
            £{totals.total.toFixed(2)}
          </span>
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
        <Input
          label="Customer mobile"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          type="tel"
        />
        <Input
          label="Site address"
          value={siteAddress}
          onChange={(e) => setSiteAddress(e.target.value)}
        />
        {!hasContactChannel && (
          <p className="text-xs text-text-muted">
            Add a mobile number or email so we know how to reach them.
          </p>
        )}
        <Button
          type="button"
          onClick={send}
          disabled={isSending || !customerName.trim() || !hasContactChannel}
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
              <p>Quote sent to {customerEmail}.</p>
            ) : (
              <p>
                We couldn&apos;t email this one — copy this link and send it to
                your customer:{" "}
                <InlineLink href={sendResult.quoteUrl} external>
                  {sendResult.quoteUrl}
                </InlineLink>
              </p>
            )}
          </div>
        )}
      </Card>
    </section>
  );
};
