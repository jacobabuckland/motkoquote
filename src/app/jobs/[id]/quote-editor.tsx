"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals } from "@/lib/quote-math";
import { formatGBP } from "@/lib/format";
import { updateQuoteLineItems, sendQuote } from "../actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

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
  // Legacy quotes drafted before the multiplier/people_count fields existed
  // have them genuinely missing at runtime (line_items_json is loaded via a
  // type cast, not zod parsing) — normalize on the way into state so the
  // inputs show 1 instead of blank.
  const router = useRouter();
  const [lineItems, setLineItems] = useState<LineItem[]>(() =>
    initialLineItems.map((item) => ({
      ...item,
      multiplier: item.multiplier ?? 1,
      people_count: item.people_count ?? 1,
    })),
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
  const [smsOptOut, setSmsOptOut] = useState(false);
  // Default to sending on every channel that has contact info — the
  // contractor can deselect one before hitting send (e.g. they know the
  // customer prefers a call, not a text).
  const [sendViaEmail, setSendViaEmail] = useState(true);
  const [sendViaSms, setSendViaSms] = useState(true);
  const [isSending, startSending] = useTransition();
  const hasContactChannel = Boolean(customerEmail.trim() || customerPhone.trim());
  const [sendResult, setSendResult] = useState<
    | {
        delivered: boolean;
        quoteUrl: string;
        email: { attempted: boolean; delivered: boolean };
        sms: { attempted: boolean; delivered: boolean };
      }
    | { error: string }
    | null
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
            smsOptOut,
          },
          channels: { email: sendViaEmail, sms: sendViaSms },
        });
        // Delivered cleanly → hand off to the job hub's celebratory state.
        // If nothing reached the customer, stay put so the copy-link
        // fallback below is available.
        if (result.delivered) {
          const deliveredChannels = [
            result.email.delivered && "email",
            result.sms.delivered && "sms",
          ].filter(Boolean);
          router.push(`/jobs/${jobId}?sent=quote&channels=${deliveredChannels.join(",")}`);
          router.refresh();
          return;
        }
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
              {item.category === "labour" && (
                <Input
                  label="People"
                  type="number"
                  min={1}
                  step="1"
                  value={item.people_count}
                  onChange={(e) =>
                    updateItem(index, { people_count: Number(e.target.value) })
                  }
                />
              )}
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
              people_count: 1,
              overtime: false,
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
          <span className="tabular-nums">{formatGBP(totals.subtotal)}</span>
        </div>
        {vatRegistered && (
          <div className="flex justify-between">
            <span className="text-text-secondary">VAT (20%)</span>
            <span className="tabular-nums">{formatGBP(totals.vat)}</span>
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatGBP(totals.total)}
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

        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Send by
          </span>
          <Checkbox
            label="Email"
            checked={sendViaEmail}
            disabled={!customerEmail.trim()}
            onChange={(e) => setSendViaEmail(e.target.checked)}
          />
          <Checkbox
            label="Text message"
            checked={sendViaSms && !smsOptOut}
            disabled={!customerPhone.trim() || smsOptOut}
            onChange={(e) => setSendViaSms(e.target.checked)}
          />
          {customerPhone.trim() && (
            <Checkbox
              label="Customer doesn't want texts"
              checked={smsOptOut}
              onChange={(e) => setSmsOptOut(e.target.checked)}
            />
          )}
        </div>

        <Button
          type="button"
          onClick={send}
          disabled={
            isSending ||
            !customerName.trim() ||
            !hasContactChannel ||
            (!sendViaEmail && !(sendViaSms && !smsOptOut))
          }
          className="self-start"
        >
          {isSending ? "Sending..." : "Send quote"}
        </Button>
        {!isSending && !customerName.trim() && (
          <p className="text-xs text-text-muted">Add the customer&apos;s name to send.</p>
        )}
        {!isSending &&
          customerName.trim() &&
          hasContactChannel &&
          !sendViaEmail &&
          !(sendViaSms && !smsOptOut) && (
            <p className="text-xs text-text-muted">
              Pick at least one way to send it — email or text.
            </p>
          )}

        {sendResult && "error" in sendResult && (
          <p className="text-sm text-error">{sendResult.error}</p>
        )}
        {sendResult && "delivered" in sendResult && (
          <div className="flex flex-col gap-1 text-sm text-text-secondary">
            {sendResult.email.attempted && (
              <p>
                {sendResult.email.delivered
                  ? `Emailed to ${customerEmail}.`
                  : "Email delivery failed."}
              </p>
            )}
            {sendResult.sms.attempted && (
              <p>
                {sendResult.sms.delivered
                  ? `Texted to ${customerPhone}.`
                  : "Text delivery failed."}
              </p>
            )}
            <p>
              Nothing reached {customerName || "the customer"} — copy this link and send it to
              them directly.
            </p>
            <CopyLinkButton url={sendResult.quoteUrl} label="Copy quote link" />
          </div>
        )}
      </Card>
    </section>
  );
};
