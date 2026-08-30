"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { LineItem, LinePerson } from "@/lib/schemas/job";
import type { PricingMode } from "@/lib/schemas/sow";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import { editWillDiverge } from "@/lib/sent-quote-disclosure";
import { EDIT_AFTER_SEND_WARNING } from "@/lib/sent-quote-copy";
import { formatGBP } from "@/lib/format";
import {
  updateQuoteLineItems,
  sendQuote,
  redraftJob,
  reportEmptyQuoteDraft,
  setQuotePricingMode,
} from "../actions";
import { sendButtonLabel } from "./send-button-label";
import {
  ZERO_TOTAL_CONFIRM_REQUIRED,
  parseNarrativeConfirm,
  type NarrativeConfirmDetail,
} from "@/lib/quote-send-guards";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import * as haptics from "@/lib/haptics";

type Props = {
  jobId: string;
  quoteId: string;
  jobTitle: string;
  initialLineItems: LineItem[];
  // The quote's current status, and what the customer was told at send. Both
  // are needed to warn BEFORE an edit lands rather than after: once the write
  // has happened the customer's copy already disagrees, and the only remaining
  // remedy is a re-send the contractor does not know they need (#370).
  quoteStatus?: string;
  sentTotal?: number | null;
  contractorFlags?: string[];
  vatRegistered: boolean;
  // True when this job went through voice drafting (so a zero-item quote is a
  // pricing failure, not the deliberately-empty manual/typed fallback).
  draftExpected?: boolean;
  // How this quote is currently priced (Task B) and, for fixed mode, the
  // stated net total. Drives the "Priced as" control below.
  initialPricingMode?: PricingMode;
  initialFixedAmount?: number | null;
  initialCustomerName?: string;
  initialCustomerEmail?: string;
  initialCustomerPhone?: string;
  initialSiteAddress?: string;
};

export const QuoteEditor = ({
  jobId,
  quoteId,
  jobTitle,
  initialLineItems,
  quoteStatus = "draft",
  sentTotal = null,
  contractorFlags = [],
  vatRegistered,
  draftExpected = false,
  initialPricingMode = "calculated",
  initialFixedAmount = null,
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
  const [saveError, setSaveError] = useState(false);
  // Whether local line items have drifted from the persisted row.
  //
  // NOT the same as `!saved`, which is why it exists. `saved` means "the
  // contractor clicked Save and it worked", so it is false on a freshly loaded
  // quote whose state already matches the row, and false after a pricing-mode
  // switch that the SERVER has already persisted. Sending in either case must
  // not take a redundant write; sending after a real edit must.
  const [dirty, setDirty] = useState(false);

  // A voice draft that came back with no priced lines is an error, not an
  // empty page. Log it once on mount and offer a retry that re-prices from the
  // stored SoW. The deliberately-empty manual fallback (draftExpected=false)
  // skips all of this and just shows an editable blank quote.
  const [draftFailed, setDraftFailed] = useState(
    draftExpected && initialLineItems.length === 0,
  );
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState(false);
  useEffect(() => {
    if (draftExpected && initialLineItems.length === 0) {
      // Fire-and-forget telemetry — never let a failed log surface to the user.
      void reportEmptyQuoteDraft({ jobId, quoteId }).catch(() => {});
    }
    // Only the initial draft state matters; deps intentionally omitted so this
    // fires exactly once for the failed draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setRetryError(false);
    startRetry(async () => {
      try {
        const { lineItemCount } = await redraftJob({ jobId });
        if (lineItemCount > 0) {
          setDraftFailed(false);
          router.refresh();
        } else {
          setRetryError(true);
        }
      } catch {
        setRetryError(true);
      }
    });
  };

  // Pricing mode (Task B). "fixed" collapses the quote to a single works line
  // at a stated net total; "calculated"/"days" show the itemised breakdown.
  // Switching recomputes server-side from the retained calculated breakdown
  // (drafted_line_items_json) and hands the new lines straight back so local
  // state updates without a full reload.
  const [pricingMode, setPricingMode] = useState<PricingMode>(initialPricingMode);
  const [fixedAmount, setFixedAmount] = useState<number | null>(initialFixedAmount);
  const [fixedInput, setFixedInput] = useState(
    initialFixedAmount != null ? String(initialFixedAmount) : "",
  );
  const [switching, startSwitching] = useTransition();
  const [switchError, setSwitchError] = useState(false);

  const normalizeItems = (items: LineItem[]): LineItem[] =>
    items.map((item) => ({
      ...item,
      multiplier: item.multiplier ?? 1,
      people_count: item.people_count ?? 1,
    }));

  const switchPricingMode = (mode: PricingMode, amount?: number | null) => {
    setSwitchError(false);
    startSwitching(async () => {
      try {
        const result = await setQuotePricingMode({
          jobId,
          quoteId,
          mode,
          fixedAmount: amount ?? null,
        });
        setLineItems(normalizeItems(result.lineItems));
        setPricingMode(mode);
        setSaved(false);
        // setQuotePricingMode persisted these lines itself, so there is
        // nothing pending — the button reads "Save changes" again, but a send
        // has nothing to write.
        setDirty(false);
        if (mode === "fixed") {
          // Read the applied figure back off the works line so a seeded
          // (subtotal-derived) amount is reflected in the input.
          const applied = result.lineItems[0]?.unit_price ?? amount ?? null;
          setFixedAmount(applied);
          setFixedInput(applied != null ? String(applied) : "");
        } else {
          setFixedAmount(null);
        }
      } catch {
        setSwitchError(true);
      }
    });
  };

  // Pre-filled from whatever the contractor mentioned during the voice
  // call (see sow.customer_name etc.) — still editable/correctable here,
  // never auto-sent without a human reviewing it first.
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone ?? "");
  const [siteAddress, setSiteAddress] = useState(initialSiteAddress ?? "");
  // Proper nouns are easily misheard on the phone. Any of these three fields
  // that arrived pre-filled from the voice call carries a "check the spelling"
  // hint until the contractor either edits the value or taps to confirm it. A
  // field left blank by the call never shows the hint (nothing to mis-spell).
  const [voiceHintFields, setVoiceHintFields] = useState<Set<"name" | "email" | "address">>(() => {
    const hinted = new Set<"name" | "email" | "address">();
    if (initialCustomerName?.trim()) hinted.add("name");
    if (initialCustomerEmail?.trim()) hinted.add("email");
    if (initialSiteAddress?.trim()) hinted.add("address");
    return hinted;
  });
  const clearVoiceHint = (field: "name" | "email" | "address") =>
    setVoiceHintFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  const renderVoiceHint = (field: "name" | "email" | "address") =>
    voiceHintFields.has(field) ? (
      <button
        type="button"
        onClick={() => clearVoiceHint(field)}
        className="flex items-center gap-1 self-start text-xs text-warning"
      >
        From the call — check the spelling. Tap to confirm.
      </button>
    ) : null;
  const [smsOptOut, setSmsOptOut] = useState(false);
  // Contractor flags never render on the customer document — they're
  // editor-only prompts to check before sending. Dismissing one hides it
  // for this session.
  const [dismissedFlags, setDismissedFlags] = useState<string[]>([]);
  const activeFlags = contractorFlags.filter((flag) => !dismissedFlags.includes(flag));
  // Collapsed by default when there are more than three flags so the panel
  // never buries the priced quote; a short list stays open.
  const [flagsExpanded, setFlagsExpanded] = useState(contractorFlags.length <= 3);
  // A flag "belongs" to a line when the compiler prefixed it with that line's
  // description ("Wet room tanking: confirm the membrane spec"). Those render
  // inline on the line; the note is everything after the "description: " prefix.
  const lineFlags = (description: string): string[] =>
    activeFlags
      .filter((flag) => flag.startsWith(`${description}: `))
      .map((flag) => flag.slice(description.length + 2));

  // Default to sending on every channel that has contact info — the
  // contractor can deselect one before hitting send (e.g. they know the
  // customer prefers a call, not a text).
  const [sendViaEmail, setSendViaEmail] = useState(true);
  const [sendViaSms, setSendViaSms] = useState(true);
  const [isSending, startSending] = useTransition();
  // Terminal success state. Once a send delivers we flip this and it takes
  // precedence over the pending spinner in the button label, so the control
  // reads "Sent ✓" while the client navigates away — it can never rest on
  // "Sending…" if the post-send navigation stalls.
  const [sent, setSent] = useState(false);
  // Belt-and-braces for a pathological send: the server action always resolves
  // inside its timeout budget now, but if the round-trip itself stalls past 20s
  // we stop showing an eternal spinner and point the contractor at the job page
  // (where a server-side status flip may already show the quote as sent).
  const [sendSlow, setSendSlow] = useState(false);
  const sendSlowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Navigation timer for the post-send dwell — holds the "Sent ✓" state visible
  // for ~450ms before navigating away, per the settled end-state pattern.
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContactChannel = Boolean(customerEmail.trim() || customerPhone.trim());
  // Only an error keeps the contractor on the editor now: a successful send —
  // even one that reached no channel — is a spent form, so it always hands off
  // to the job page (the delivered=0 banner there carries the copy-link
  // fallback). The editor never rests on a completed send.
  const [sendResult, setSendResult] = useState<{ error: string } | null>(null);

  // Cancel the navigation timer on unmount to prevent attempting to navigate
  // after the component is gone.
  useEffect(() => {
    return () => {
      if (navigationTimer.current) {
        clearTimeout(navigationTimer.current);
        navigationTimer.current = null;
      }
    };
  }, []);

  const totals = useMemo(
    () => computeQuoteTotals(lineItems, vatRegistered),
    [lineItems, vatRegistered],
  );

  // Live, so it appears the moment the edit makes the figures disagree — the
  // contractor is warned while they can still act, rather than told afterwards
  // that their customer has already been shown a notice (#370).
  const willDiverge = editWillDiverge(quoteStatus, sentTotal, totals.total);

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setSaved(false);
    setDirty(true);
    setSaveError(false);
    // Mark the line as edited so a later recompute preserves the
    // contractor's manual figure rather than overwriting it with a fresh
    // computed amount. Also update provenance to contractor-sourced.
    setLineItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, ...patch, edited: true, provenance: { source: "contractor" } }
          : item,
      ),
    );
  };

  // Edit one person on a labour line's crew breakdown. `people` is the source
  // of truth for the amount, so days/day_rate here (not unit_price) drive the
  // line total.
  const updatePerson = (
    index: number,
    personIndex: number,
    patch: Partial<LinePerson>,
  ) => {
    setSaved(false);
    setDirty(true);
    setSaveError(false);
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== index || !item.people) return item;
        return {
          ...item,
          edited: true,
          provenance: { source: "contractor" },
          people: item.people.map((p, pi) =>
            pi === personIndex ? { ...p, ...patch } : p,
          ),
        };
      }),
    );
  };

  const removeItem = (index: number) => {
    setSaved(false);
    setDirty(true);
    setSaveError(false);
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    setSaveError(false);
    startTransition(async () => {
      try {
        await updateQuoteLineItems({ jobId, quoteId, lineItems });
        setSaved(true);
        setDirty(false);
      } catch {
        // Never fail silently — surface it so the contractor can retry
        // rather than assuming their edits were saved.
        setSaveError(true);
      }
    });
  };

  // A £0 total with no unresolved-rate flag is a deliberate zero — a goodwill
  // callout, a warranty visit. The server asks rather than refuses, and this
  // holds the ask until the contractor answers it. Blocking a legitimate £0
  // quote would create a support problem that never arrives as a bug report.
  const [confirmingZeroTotal, setConfirmingZeroTotal] = useState(false);

  // The quote's own Scope of work names a price the priced figures don't
  // support. Same posture as the £0 question: the server asks, this holds the
  // ask, and the contractor decides. Carries both figures so they can see which
  // one is wrong rather than being told only that something is.
  const [confirmingNarrative, setConfirmingNarrative] =
    useState<NarrativeConfirmDetail | null>(null);

  // Both questions can be asked in turn on one send — the £0 check runs first,
  // so a £0 quote whose narrative names a price meets the narrative question on
  // the re-send. Answering the second must not un-answer the first, so the
  // answers accumulate here instead of living only in the argument.
  const confirmed = useRef({ zeroTotal: false, narrativeMismatch: false });

  const send = (confirm: Partial<typeof confirmed.current> = {}) => {
    confirmed.current = { ...confirmed.current, ...confirm };
    setSendResult(null);
    setConfirmingZeroTotal(false);
    setConfirmingNarrative(null);
    setSendSlow(false);
    if (sendSlowTimer.current) clearTimeout(sendSlowTimer.current);
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    sendSlowTimer.current = setTimeout(() => setSendSlow(true), 20_000);
    startSending(async () => {
      try {
        // Persist before sending. sendQuote reads line_items_json and total
        // back off the row, so an unsaved edit meant the customer received the
        // PREVIOUS figures on both the message and the page — and the edit was
        // then discarded when this component unmounted on navigation. The
        // header total is computed from local state, so the contractor watched
        // the new number the whole time.
        //
        // A failed persist must ABORT the send rather than fall through to it:
        // sending stale figures silently is the defect, and doing it after a
        // visible write failure would be worse.
        if (dirty) {
          try {
            await updateQuoteLineItems({ jobId, quoteId, lineItems });
            setSaved(true);
            setDirty(false);
          } catch {
            setSaveError(true);
            return;
          }
        }

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
          confirmZeroTotal: confirmed.current.zeroTotal,
          confirmNarrativeMismatch: confirmed.current.narrativeMismatch,
        });
        // A send that reached no channel still marks the quote "sent" server
        // side — it's a spent form either way, so both paths hand off to the
        // job hub. Terminal "Sent ✓" first, then navigate: if the push/refresh
        // below stalls, the button rests on "Sent ✓", never on "Sending…".
        // Delivered → celebratory banner with the channels that landed.
        // Delivered nothing → delivered=0 banner carrying the copy-link
        // fallback, mirroring the contract path.

        // Fire light haptic when terminal state is reached
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        setSent(true);

        // Dwell on the "Sent ✓" state for ~450ms before navigating.
        const targetRoute = result.delivered
          ? `/jobs/${jobId}?sent=quote&channels=${[
              result.email.delivered && "email",
              result.sms.delivered && "sms",
            ].filter(Boolean).join(",")}`
          : `/jobs/${jobId}?sent=quote&delivered=0`;
        // Hold the terminal state visible, then navigate after 450ms.
        navigationTimer.current = setTimeout(() => { navigationTimer.current = null; router.push(targetRoute); router.refresh(); }, 450);
        return;
      } catch (err) {
        // Not a failure: the server is asking whether the zero is deliberate.
        // Surface the question in place rather than as an error.
        if (err instanceof Error && err.message.includes(ZERO_TOTAL_CONFIRM_REQUIRED)) {
          setConfirmingZeroTotal(true);
          return;
        }
        // Also a question, not a failure: the document contradicts itself and
        // the contractor is the only one who knows which figure is right.
        const narrativeConfirm =
          err instanceof Error ? parseNarrativeConfirm(err.message) : null;
        if (narrativeConfirm) {
          setConfirmingNarrative(narrativeConfirm);
          return;
        }
        haptics.error();
        setSendResult({
          error: err instanceof Error ? err.message : "Failed to send quote",
        });
      } finally {
        if (sendSlowTimer.current) {
          clearTimeout(sendSlowTimer.current);
          sendSlowTimer.current = null;
        }
        setSendSlow(false);
      }
    });
  };

  // Why "Send quote" can't fire yet — surfaced under the button so the
  // contractor knows what to fix rather than facing a dead disabled control.
  const sendBlockedReason = !customerName.trim()
    ? "Add the customer's name to send."
    : !hasContactChannel
      ? "Add a mobile number or email so we know how to reach them."
      : !sendViaEmail && !(sendViaSms && !smsOptOut)
        ? "Pick at least one way to send it — email or text."
        : null;

  return (
    <section className="flex flex-col gap-4">
      {/* Header — the priced quote, up top: job, who it's for, the total. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-lg font-semibold">{jobTitle}</h2>
          <p className="truncate text-sm text-text-secondary">
            {customerName.trim() || "Add customer below"}
          </p>
        </div>
        <span className="shrink-0 text-2xl font-semibold tabular-nums">
          {formatGBP(totals.total)}
        </span>
      </div>

      {draftFailed && (
        <Card className="flex flex-col gap-3 border-error bg-error-bg">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-error">
              Something went wrong pricing this job
            </h3>
            <p className="text-sm text-text-secondary">
              We captured the job but couldn&apos;t turn it into priced line items.
              Try again, or build the quote by hand below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={retry} disabled={retrying}>
              {retrying ? "Pricing…" : "Retry pricing"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDraftFailed(false)}
              disabled={retrying}
            >
              Build by hand
            </Button>
          </div>
          {retryError && (
            <p className="text-sm text-error">
              Still couldn&apos;t price it. You can build the quote by hand below.
            </p>
          )}
        </Card>
      )}

      {/* Pricing mode (Task B) — how this quote is priced, with a control to
          switch. Scope (the SoW) is unaffected either way. */}
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Priced as
            </span>
            <span className="text-sm font-medium">
              {pricingMode === "fixed"
                ? `Fixed price — ${formatGBP(fixedAmount ?? 0)}${vatRegistered ? " + VAT" : ""}`
                : "Itemised from your rates"}
            </span>
          </div>
          {pricingMode === "fixed" ? (
            <Button
              type="button"
              variant="tertiary"
              className="shrink-0"
              onClick={() => switchPricingMode("calculated")}
              disabled={switching}
            >
              {switching ? "Switching…" : "Switch to itemised"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="tertiary"
              className="shrink-0"
              onClick={() => switchPricingMode("fixed")}
              disabled={switching}
            >
              {switching ? "Switching…" : "Switch to fixed price"}
            </Button>
          )}
        </div>
        {pricingMode === "fixed" && (
          <div className="flex items-end gap-2">
            <Input
              label={`Fixed price (£${vatRegistered ? ", before VAT" : ""})`}
              type="number"
              className="flex-1"
              value={fixedInput}
              onChange={(e) => setFixedInput(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={() => switchPricingMode("fixed", Number(fixedInput))}
              disabled={switching || !(Number(fixedInput) > 0)}
            >
              Update price
            </Button>
          </div>
        )}
        {switchError && (
          <p className="text-sm text-error">
            Couldn&apos;t update the pricing — check your connection and try again.
          </p>
        )}
      </Card>

      {/* Line items — the reason this page exists. */}
      <div className="flex flex-col gap-3">
        {lineItems.map((item, index) => {
          const flags = lineFlags(item.description);
          return (
            <Card key={index} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <input
                  aria-label={`Line item ${index + 1} description`}
                  value={item.description}
                  onChange={(e) => updateItem(index, { description: e.target.value })}
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
              {flags.length > 0 && (
                <details className="rounded-control border border-warning bg-warning/5 px-2 py-1.5">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-warning">
                    <span aria-hidden>⚠</span>
                    Check before sending ({flags.length})
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1 text-xs text-text-secondary">
                    {flags.map((note, fi) => (
                      <li key={fi}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  label="Qty"
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
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
                  onChange={(e) => updateItem(index, { unit_price: Number(e.target.value) })}
                />
                <Input
                  label="Multiplier"
                  type="number"
                  step="0.1"
                  value={item.multiplier}
                  onChange={(e) => updateItem(index, { multiplier: Number(e.target.value) })}
                />
                {item.category === "labour" && !(item.people && item.people.length > 0) && (
                  <Input
                    label="People"
                    type="number"
                    min={1}
                    step="1"
                    value={item.people_count}
                    onChange={(e) => updateItem(index, { people_count: Number(e.target.value) })}
                  />
                )}
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
                <span className="text-text-secondary">Line total</span>
                <span className="tabular-nums font-medium">
                  {formatGBP(lineItemTotal(item))}
                </span>
              </div>
              {item.people && item.people.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    Crew
                  </span>
                  {item.people.map((person, pi) => (
                    <div
                      key={pi}
                      className="grid grid-cols-[minmax(0,1fr)_4rem_5rem] items-end gap-2"
                    >
                      <span className="truncate pb-2 text-sm">{person.label}</span>
                      <Input
                        label="Days"
                        type="number"
                        step="0.5"
                        className="w-full min-w-0"
                        value={person.days}
                        onChange={(e) => updatePerson(index, pi, { days: Number(e.target.value) })}
                      />
                      <Input
                        label="Day rate (£)"
                        type="number"
                        className="w-full min-w-0"
                        value={person.day_rate}
                        onChange={(e) =>
                          updatePerson(index, pi, { day_rate: Number(e.target.value) })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              {item.includes_tasks && item.includes_tasks.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
                  {item.includes_tasks.map((task, ti) => (
                    <li key={ti}>• {task}</li>
                  ))}
                </ul>
              )}
              {item.assumed && (
                <p className="text-xs text-warning">
                  {/* Strip any trailing full stop the drafting model left on
                      the note so it never collides with the one below into
                      "…note.. Confirm before sending.". */}
                  Assumed
                  {item.assumption_note
                    ? ` — ${item.assumption_note.replace(/\.\s*$/, "")}`
                    : ""}
                  . Confirm before sending.
                </p>
              )}
              <Input
                label="Customer note (shows on the quote)"
                value={item.customer_note ?? ""}
                onChange={(e) =>
                  updateItem(index, { customer_note: e.target.value || undefined })
                }
              />
            </Card>
          );
        })}
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
              provenance: { source: "contractor" },
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
          <span className="text-2xl font-semibold tabular-nums">{formatGBP(totals.total)}</span>
        </div>
      </div>

      {willDiverge && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
        >
          <p>{EDIT_AFTER_SEND_WARNING}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Button type="button" variant="secondary" onClick={save} disabled={isPending}>
          {isPending ? "Saving..." : saveError ? "Try again" : saved ? "Saved" : "Save changes"}
        </Button>
        {saveError && (
          <p className="text-sm text-error">
            Couldn&apos;t save your changes — check your connection and try again.
          </p>
        )}
      </div>

      {/* Contractor flags — compact, collapsible, below the quote. Never on the
          customer document; a prompt to check before sending. */}
      {activeFlags.length > 0 && (
        <div className="flex flex-col rounded-card border border-warning bg-warning/5">
          <button
            type="button"
            onClick={() => setFlagsExpanded((v) => !v)}
            aria-expanded={flagsExpanded}
            className="flex min-h-11 items-center justify-between gap-2 px-4 text-left"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-warning">
              Before you send ({activeFlags.length})
            </span>
            <span className="text-xs font-medium text-text-muted">
              {flagsExpanded ? "Hide" : "Show"}
            </span>
          </button>
          {flagsExpanded && (
            <ul className="flex flex-col gap-2 px-4 pb-3">
              {activeFlags.map((flag, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-sm">
                  <span>{flag}</span>
                  <button
                    type="button"
                    onClick={() => setDismissedFlags((prev) => [...prev, flag])}
                    className="shrink-0 text-xs font-medium text-text-muted hover:text-text-primary"
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Send to customer
        </h3>
        <div className="flex flex-col gap-1">
          <Input
            label="Customer name"
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              clearVoiceHint("name");
            }}
          />
          {renderVoiceHint("name")}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="Customer email"
            value={customerEmail}
            onChange={(e) => {
              setCustomerEmail(e.target.value);
              clearVoiceHint("email");
            }}
            type="email"
          />
          {renderVoiceHint("email")}
        </div>
        <Input
          label="Customer mobile"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          type="tel"
        />
        <div className="flex flex-col gap-1">
          <Input
            label="Site address"
            value={siteAddress}
            onChange={(e) => {
              setSiteAddress(e.target.value);
              clearVoiceHint("address");
            }}
          />
          {renderVoiceHint("address")}
        </div>

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
          onClick={() => send()}
          disabled={sent || isSending || Boolean(sendBlockedReason)}
          className={`self-start ${sent ? "bg-green-tint text-green" : ""}`}
        >
          {sent && (
            <svg
              className="inline-block w-5 h-5 mr-1.5 -ml-1"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path
                d="M5 12l5 5L20 7"
                strokeDasharray="100"
                strokeDashoffset="0"
                className="check-draw-animation"
              />
            </svg>
          )}
          {sendButtonLabel({ sent, isSending, resend: quoteStatus === "sent" })}
        </Button>
        {confirmingZeroTotal && (
          <div className="flex flex-col gap-2 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">This quote totals £0.00. Send it anyway?</p>
            <p className="text-xs text-text-secondary">
              That&apos;s fine for a goodwill visit or work under warranty — the customer
              will see a quote for nothing to pay.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => send({ zeroTotal: true })}
                disabled={isSending}
              >
                Yes, send it for £0.00
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingZeroTotal(false)}
                disabled={isSending}
              >
                Go back and price it
              </Button>
            </div>
          </div>
        )}
        {confirmingNarrative && (
          <div className="flex flex-col gap-2 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">
              This quote gives two different prices. Send it anyway?
            </p>
            {confirmingNarrative.stated != null &&
            confirmingNarrative.subtotal != null ? (
              <p className="text-xs text-text-secondary">
                The Scope of work says{" "}
                <strong>{formatGBP(confirmingNarrative.stated)}</strong>, and the
                priced lines come to{" "}
                <strong>{formatGBP(confirmingNarrative.subtotal)}</strong> before
                VAT. The customer sees both on the same page, and the priced
                figure is the one they&apos;ll be asked to pay.
              </p>
            ) : (
              <p className="text-xs text-text-secondary">
                The price recorded for this job doesn&apos;t match the one the
                quote charges. The customer sees both, and the priced figure is
                the one they&apos;ll be asked to pay.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => send({ narrativeMismatch: true })}
                disabled={isSending}
              >
                Yes, send it as it is
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingNarrative(null)}
                disabled={isSending}
              >
                Go back and check it
              </Button>
            </div>
          </div>
        )}
        {!isSending && sendBlockedReason && (
          <p className="text-xs text-text-muted">{sendBlockedReason}</p>
        )}
        {sendSlow && isSending && (
          <p className="text-sm text-warning">
            This is taking longer than expected — your quote may already have been sent.{" "}
            <a href={`/jobs/${jobId}`} className="underline">
              Check the job page
            </a>
            .
          </p>
        )}

        {sendResult && (
          <p className="text-sm text-error">{sendResult.error}</p>
        )}
      </Card>
    </section>
  );
};
