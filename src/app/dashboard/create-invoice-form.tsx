"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "./actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { InlineLink } from "@/components/ui/inline-link";
import { ShareLinkButton } from "@/components/ui/share-link-button";
import * as haptics from "@/lib/haptics";

type Props = {
  quoteId: string;
  quoteTotal: number;
  jobId?: string;
  customerName?: string;
};

export const CreateInvoiceForm = ({ quoteId, quoteTotal, jobId, customerName }: Props) => {
  const router = useRouter();
  const [invoiceType, setInvoiceType] = useState<"deposit" | "final">("final");
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    paymentUrl: string | null;
    delivered: boolean;
    payoutSetupRequired: boolean;
  } | null>(null);

  if (result) {
    const name = customerName ?? "your customer";
    // Payout setup outstanding: the invoice still went out, but with no online
    // payment option. Nudge them to finish setup without blocking anything.
    if (result.payoutSetupRequired) {
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-success">
            {result.delivered
              ? `Invoice sent to ${name} (email).`
              : `Invoice created for ${name}.`}
          </p>
          <p className="text-text-secondary">
            To let customers pay online — straight to your bank — finish setting
            up payouts. Until then, arrange payment with {name} directly.
          </p>
          <InlineLink href="/settings">Finish payout setup</InlineLink>
        </div>
      );
    }
    if (result.delivered) {
      return (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-success">Invoice sent to {name} (email).</p>
          <p className="text-text-secondary">
            They can pay online through the link. We&apos;ll email you when the payment lands.
            Nothing else needs you until then.
          </p>
          {result.paymentUrl && <ShareLinkButton url={result.paymentUrl} title={`Payment link for ${name}`} label="Copy payment link" />}
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
            <ShareLinkButton url={result.paymentUrl} title={`Payment link for ${name}`} label="Copy payment link" />
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
              dueDate: dueDate || undefined,
            });
            // The invoice row is created regardless of delivery or payout
            // setup, so this is a spent form every time — always hand off to
            // the job hub rather than resting here. The banner there carries
            // the right variant: the copy-link fallback when nothing was
            // emailed (delivered=0) and the finish-payout-setup nudge when the
            // owner can't yet take online payments (payout=setup). The server
            // action already revalidated the job/dashboard data, so a single
            // push lands on fresh RSC. (router.refresh() here races the push
            // and wedges the transition on "Sending…".)
            if (jobId) {
              const params = new URLSearchParams({ sent: "invoice" });
              if (!res.delivered) params.set("delivered", "0");
              if (res.payoutSetupRequired) params.set("payout", "setup");
              haptics.success();
              router.push(`/jobs/${jobId}?${params.toString()}`);
              return;
            }
            setResult({
              paymentUrl: res.paymentUrl,
              delivered: res.delivered,
              payoutSetupRequired: res.payoutSetupRequired,
            });
          } catch (err) {
            haptics.error();
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
          type="text"
          readOnly
          className="tabular-nums"
          // Display-only. The exact figure is worked out on the server from the
          // quote total, the contract deposit, and any invoices already raised.
          value={invoiceType === "final" ? quoteTotal.toFixed(2) : "Auto"}
        />
        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      <p className="text-xs text-text-secondary">
        We work out the amount automatically — the deposit from your contract, or
        the balance left on the quote.
      </p>
      {error && <p className="text-sm text-error">{error}</p>}
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Sending…" : "Send invoice"}
      </Button>
    </form>
  );
};
