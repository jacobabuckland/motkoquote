"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { LineItem, LinePerson } from "@/lib/schemas/job";
import type { PricingMode } from "@/lib/schemas/sow";
import { computeQuoteTotals, displayedUnitRate, lineItemTotal } from "@/lib/quote-math";
import { parseDeposit } from "@/lib/quote-deposit";
import { quoteTotalsForDisplay } from "@/lib/vat-record";
import {
  findSupportingSpan,
  voiceHintFields as capturedFieldsToCheck,
  type CapturedDetailField,
} from "@/lib/captured-detail";
import { editWillDiverge, editWillWithdrawAcceptance } from "@/lib/sent-quote-disclosure";
import { EDIT_AFTER_ACCEPT_WARNING, EDIT_AFTER_SEND_WARNING } from "@/lib/sent-quote-copy";
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
  parseOverCeilingConfirm,
  type OverCeilingConfirmDetail,
} from "@/lib/quote-send-guards";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import * as haptics from "@/lib/haptics";
import { actionableMessage, authoredMessage, supportDigest } from "@/lib/actionable-error";

// WHAT A FAILED SAVE ACTUALLY SAYS.
//
// Both write paths reported "check your connection and try again" for every
// failure, including the two no amount of retrying can fix: a quote locked
// because a contract has been raised from it, and one the customer has already
// declined. The contractor blames their signal and retries something that
// cannot work — and while they retry, the editor keeps showing the rejected
// figures beside a total that is really something else, with nothing on screen
// saying which number is real. Reported 15 Sep on jobs 8f881709 and a2c25d01.
//
// The server has always thrown the authored reason through `actionableError`,
// so it survives Next's production redaction. The editor discarded it and
// stored a boolean.
const SAVE_CONNECTION_FALLBACK =
  "Couldn't save your changes. Check your connection and try again.";

const PRICING_CONNECTION_FALLBACK =
  "Couldn't update the pricing. Check your connection and try again.";

const saveFailureMessage = (err: unknown): string =>
  authoredMessage(err) ?? SAVE_CONNECTION_FALLBACK;

/**
 * Whether the control should invite another attempt.
 *
 * Only the connection fallback is worth retrying. A refusal the server authored
 * is a settled fact about the quote, and offering "Try again" for it is the
 * same untruth in a different place.
 */
const failureIsRetryable = (message: string | null): boolean =>
  message === SAVE_CONNECTION_FALLBACK || message === PRICING_CONNECTION_FALLBACK;
import { parseStatedPriceMismatch } from "@/lib/stated-price-guard";

// What to say when the send failed for a reason we did not author — a database
// write, an upstream API, a bug. The message is redacted in production and
// SHOULD be: it is a stack or a Postgres string, not something a contractor can
// act on. React's "the specific message is omitted in production builds" notice
// is not an improvement on that, so it never reaches the screen; the digest
// does, because it is the one handle that ties this screen to the server log.
const unexpectedSendFailure = (err: unknown): string => {
  const digest = supportDigest(err);
  return (
    "Couldn't send the quote — something went wrong at our end. Try again, " +
    "and use Download quote to send it yourself if it keeps failing." +
    (digest ? ` (reference ${digest})` : "")
  );
};

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
  /**
   * The deposit already agreed on this quote, in pennies (migration 81).
   * Null where none was agreed; 0 where one was agreed at nothing.
   */
  initialDepositPennies?: number | null;
  /**
   * The VAT split recorded on the quote row when it was last written
   * (migration 80). THE FIFTH SURFACE.
   *
   * Every other surface — the PDF, /q/[id], the job page, the contract — now
   * reads these. The editor did not, so a settings change put two totals on
   * one screen: the job page above it showing the recorded £740.00 while the
   * block inside it recomputed £888.00 from today's registration flag.
   *
   * Null on a quote written before migration 80, where recomputing is still
   * the only answer available.
   */
  recordedQuote?: { total: number; subtotal: number | null; vat_amount: number | null } | null;
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
  /** The call's flat transcript, so a captured detail can be shown against
      the words it came from. Absent on hand-typed jobs. */
  transcript?: string | null;
  initialSiteAddress?: string;
};

// Legacy quotes drafted before the multiplier/people_count fields existed have
// them genuinely missing at runtime (line_items_json is loaded via a type cast,
// not zod parsing). Shared by the state initialiser and the "as loaded"
// baseline beside it, which must agree exactly or an untouched legacy quote
// reads as edited.
const normaliseLoadedLines = (items: LineItem[]): LineItem[] =>
  items.map((item) => ({
    ...item,
    multiplier: item.multiplier ?? 1,
    people_count: item.people_count ?? 1,
  }));

export const QuoteEditor = ({
  jobId,
  quoteId,
  jobTitle,
  initialLineItems,
  quoteStatus = "draft",
  sentTotal = null,
  contractorFlags = [],
  vatRegistered,
  initialDepositPennies = null,
  recordedQuote = null,
  draftExpected = false,
  initialPricingMode = "calculated",
  initialFixedAmount = null,
  initialCustomerName,
  initialCustomerEmail,
  initialCustomerPhone,
  transcript,
  initialSiteAddress,
}: Props) => {
  const router = useRouter();
  const [lineItems, setLineItems] = useState<LineItem[]>(() =>
    normaliseLoadedLines(initialLineItems),
  );
  // THE FIGURES AS LOADED, frozen for this component's lifetime. Taken from
  // the NORMALISED lines rather than the raw prop, so a legacy quote whose
  // multiplier/people_count were filled in on the way into state does not read
  // as already edited. Held in state rather than a ref because it is read
  // during render.
  const [loadedLineItemsJson] = useState(() =>
    JSON.stringify(normaliseLoadedLines(initialLineItems)),
  );
  // THE DEPOSIT, ASKED WHERE THE PRICE IS AGREED.
  //
  // Held as the raw text the trade typed — "25%" or "£500" — because that is
  // what they should see when they come back to it, and parsed against the
  // live total on every keystroke so the error appears while they can still
  // act on it. `parseDeposit` returns errors rather than throwing, precisely
  // so a half-typed "2" on the way to "25%" is not an explosion.
  const [depositText, setDepositText] = useState(
    initialDepositPennies == null ? "" : String(initialDepositPennies / 100),
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Whether local line items have drifted from the persisted row.
  //
  // NOT the same as `!saved`, which is why it exists. `saved` means "the
  // contractor clicked Save and it worked", so it is false on a freshly loaded
  // quote whose state already matches the row, and false after a pricing-mode
  // switch that the SERVER has already persisted. Sending in either case must
  // not take a redundant write; sending after a real edit must.
  const [dirty, setDirty] = useState(false);

  // Read-first rows: at most ONE is open for editing. A page of six line items
  // each showing four inputs is a form to be survived; the same six as
  // readable rows is a quote to be checked, which is what the contractor is
  // actually doing before they send it.
  const [openRow, setOpenRow] = useState<number | null>(null);

  // The last-persisted line items, for counting what is outstanding.
  //
  // STATE, not a ref: the count is read during render, and a ref read during
  // render is both a lint error and the real bug behind it — a ref that
  // changes does not re-render, so the count would show a stale answer.
  //
  // Moved at each of the four places that clear `dirty` rather than from an
  // effect watching it. Setting state in an effect to mirror other state is
  // the wrong shape, and each of those four already knows exactly what was
  // written: the save, the send-time save, the pricing-mode switch and the
  // provenance write. Keep them together — a `setDirty(false)` without a
  // matching baseline move leaves the count reading against stale rows.
  const [savedItems, setSavedItems] = useState<LineItem[]>(initialLineItems);
  // The customer fields' saved baseline, so an edit to one of them counts as
  // unsaved work in the same way a line edit does. Without it `unsavedCount`
  // stayed 0, the amber banner is gated on it, and a typed correction sat
  // invisible until a reload threw it away — isolated on 14 Sep: the hint
  // clears (React registered the edit), nothing appears, no navigation prompt,
  // and the field reads its old value after a refresh.
  const [savedCustomer, setSavedCustomer] = useState({
    name: initialCustomerName ?? "",
    email: initialCustomerEmail ?? "",
    phone: initialCustomerPhone ?? "",
    address: initialSiteAddress ?? "",
  });

  // How much is outstanding, for the line above Save. Counts edited rows plus
  // any difference in row COUNT, so adding or removing a line reads as a
  // change rather than as nothing.

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
  const [switchError, setSwitchError] = useState<string | null>(null);

  const normalizeItems = (items: LineItem[]): LineItem[] =>
    items.map((item) => ({
      ...item,
      multiplier: item.multiplier ?? 1,
      people_count: item.people_count ?? 1,
    }));

  const switchPricingMode = (mode: PricingMode, amount?: number | null) => {
    setSwitchError(null);
    startSwitching(async () => {
      try {
        const result = await setQuotePricingMode({
          jobId,
          quoteId,
          mode,
          fixedAmount: amount ?? null,
        });
        const switched = normalizeItems(result.lineItems);
        setLineItems(switched);
        setPricingMode(mode);
        setSaved(false);
        // setQuotePricingMode persisted these lines itself, so there is
        // nothing pending — the button reads "Save changes" again, but a send
        // has nothing to write.
        setDirty(false);
        setSavedItems(switched);
        if (mode === "fixed") {
          // Read the applied figure back off the works line so a seeded
          // (subtotal-derived) amount is reflected in the input.
          const applied = result.lineItems[0]?.unit_price ?? amount ?? null;
          setFixedAmount(applied);
          setFixedInput(applied != null ? String(applied) : "");
        } else {
          setFixedAmount(null);
        }
      } catch (err) {
        setSwitchError(authoredMessage(err) ?? PRICING_CONNECTION_FALLBACK);
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

  // Called wherever setSavedItems is, so the customer half of unsavedCount
  // clears on a save exactly as the line half does. Missing it would leave the
  // amber banner stuck on after a successful save, which is its own defect.
  const markCustomerSaved = () =>
    setSavedCustomer({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      address: siteAddress,
    });

  const unsavedCount = useMemo(() => {
    let n = Math.abs(lineItems.length - savedItems.length);
    const common = Math.min(lineItems.length, savedItems.length);
    for (let i = 0; i < common; i++) {
      if (JSON.stringify(lineItems[i]) !== JSON.stringify(savedItems[i])) n += 1;
    }
    // One per changed customer field. These are unsaved work exactly as a line
    // edit is, and they are the half that was silently discardable.
    if (customerName !== savedCustomer.name) n += 1;
    if (customerEmail !== savedCustomer.email) n += 1;
    if (customerPhone !== savedCustomer.phone) n += 1;
    if (siteAddress !== savedCustomer.address) n += 1;
    return n;
  }, [
    lineItems,
    savedItems,
    customerName,
    customerEmail,
    customerPhone,
    siteAddress,
    savedCustomer,
  ]);

  // DEFEND WHAT THE EDITOR ALREADY KNOWS IS UNSAVED.
  //
  // A customer name typed into the send fields and then lost to a reload, with
  // no prompt and no recovery — reported 15 Sep. The editor was not unaware of
  // it: the amber "N unsaved changes" line was on screen at the time. It knew,
  // and let it go.
  //
  // `beforeunload` is the only thing that survives a reload, a back gesture and
  // a closed tab alike. Browsers ignore the message string and show their own
  // wording, so there is none to write; setting `returnValue` is what arms it.
  // Registered only while there is something to lose, so a clean editor never
  // interrupts anyone.
  useEffect(() => {
    if (!dirty || unsavedCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unsavedCount]);

  // Proper nouns are easily misheard on the phone. Any of these three fields
  // that arrived pre-filled from the voice call carries a "check the spelling"
  // hint until the contractor either edits the value or taps to confirm it. A
  // field left blank by the call never shows the hint (nothing to mis-spell).
  // VOICE-5: phone is in this set now, and it was the omission that mattered.
  // On job 30faef2a the captured mobile was the ONLY slot the transcript did
  // not support — and the only one with no hint on it, so nothing invited the
  // contractor to look. With SMS defaulted on, the quote was one tap from a
  // stranger.
  //
  // AND ONLY WHERE THERE WAS A CALL. The set was built from "is this field
  // filled in", which is true of a quote the contractor typed themselves — so
  // after the first send, their own customer's name, email and site address
  // came back marked in red: "From the call — check the spelling." Reproduced
  // on three typed jobs on 15 Sep, none of which had a voice session at any
  // point. Telling someone to double-check what they typed a minute ago is the
  // wrong direction of doubt, and on a product whose pitch is that it hears
  // the call correctly it is the wrong claim as well.
  //
  // A transcript is what makes "from the call" true. Without one there is
  // nothing to check the value against either — `findSupportingSpan` would
  // answer "unsupported" for every field, which is the louder mistake.
  const [voiceHintFields, setVoiceHintFields] = useState<Set<CapturedDetailField>>(() =>
    capturedFieldsToCheck(transcript, {
      name: initialCustomerName,
      email: initialCustomerEmail,
      phone: initialCustomerPhone,
      address: initialSiteAddress,
    }),
  );
  const clearVoiceHint = (field: CapturedDetailField) =>
    setVoiceHintFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  // What was actually said, per field. "Check the spelling" against nothing is
  // a formality — you cannot spot a transposition you never heard — so the
  // words behind the value are shown beside it, and their ABSENCE is stated
  // plainly rather than left to look like a pass.
  const capturedValue = (field: "name" | "email" | "phone" | "address") =>
    field === "name"
      ? initialCustomerName
      : field === "email"
        ? initialCustomerEmail
        : field === "phone"
          ? initialCustomerPhone
          : initialSiteAddress;

  const renderVoiceHint = (field: "name" | "email" | "phone" | "address") => {
    if (!voiceHintFields.has(field)) return null;

    const support = findSupportingSpan(
      transcript,
      capturedValue(field),
      field === "phone" ? "phone" : "text",
    );

    return (
      <div className="flex flex-col gap-0.5">
        {support.kind === "found" ? (
          <p className="self-start text-xs text-ink-secondary">
            You said: &ldquo;{support.span}&rdquo;
          </p>
        ) : support.kind === "unsupported" ? (
          <p className="self-start text-xs font-medium text-error">
            This isn&apos;t in the call — check it before you send.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => clearVoiceHint(field)}
          className="flex items-center gap-1 self-start text-xs text-warning"
        >
          {support.kind === "found"
            ? "Check it matches. Tap to confirm."
            : "From the call — check the spelling. Tap to confirm."}
        </button>
      </div>
    );
  };
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

  // Has anything that moves the price been touched in this session?
  //
  // While nothing has, the quote on screen IS the quote in the row, so the
  // recorded VAT split is what it should show — that is the whole of migration
  // 80. The moment a line moves, the contractor is building a new price and
  // there is nothing recorded to show yet, so it recomputes exactly as before.
  //
  // Compared structurally rather than read off `dirty`: `dirty` is documented
  // as false after a pricing-mode switch the server has already persisted, and
  // a stale total is precisely what must not survive that.
  const linesUnchanged = useMemo(
    () => JSON.stringify(lineItems) === loadedLineItemsJson,
    [lineItems, loadedLineItemsJson],
  );

  // The fifth VAT surface (14 Sep). The block inside the job page recomputed
  // from `vatRegistered` while the page around it read the recorded columns,
  // so switching registration put two totals on one screen — £740.00 in the
  // header over £888.00 in the editor, on the same quote.
  const totals = useMemo(
    () =>
      linesUnchanged && recordedQuote
        ? quoteTotalsForDisplay(recordedQuote, lineItems, vatRegistered)
        : computeQuoteTotals(lineItems, vatRegistered),
    [linesUnchanged, recordedQuote, lineItems, vatRegistered],
  );

  // Live, so it appears the moment the edit makes the figures disagree — the
  // contractor is warned while they can still act, rather than told afterwards
  // that their customer has already been shown a notice (#370).
  const willDiverge = editWillDiverge(quoteStatus, sentTotal, totals.total);

  // Not gated on the total moving: saving an accepted quote clears accepted_at
  // whether or not the figure changed, so the contractor is told on any edit,
  // while they can still decide not to save.
  const willWithdrawAcceptance = editWillWithdrawAcceptance(quoteStatus);

  // THE DEPOSIT DOES NOT RESCALE, AND THAT IS THE POINT.
  //
  // `quotes.deposit_pennies` is an absolute figure (migration 81), so an edit
  // that moves the total leaves it pinned to the old one: pass 12 watched £315
  // stay put while the job went £1,260 -> £1,860, quietly turning an agreed 25%
  // into 16.9%. Nothing told the contractor.
  //
  // This states the new share and stops. It does not silently re-derive the
  // deposit, because that would change what a customer is asked to pay without
  // anyone choosing it — the same reasoning as KNOW-1's "suggest, never apply".
  // The contractor has the deposit field open in front of them and can adjust it.
  const depositShareNotice = useMemo(() => {
    const agreed = initialDepositPennies;
    if (agreed == null || agreed <= 0) return null;
    const nextPennies = Math.round(totals.total * 100);
    if (nextPennies <= 0) return null;
    const originalPennies = sentTotal != null ? Math.round(sentTotal * 100) : null;
    if (originalPennies == null || originalPennies === nextPennies) return null;
    const share = Math.round((agreed / nextPennies) * 1000) / 10;
    const wasShare = Math.round((agreed / originalPennies) * 1000) / 10;
    if (share === wasShare) return null;
    return `The agreed deposit of ${formatGBP(agreed / 100)} was ${wasShare}% of the old total and is ${share}% of this one. Change it below if that is not what you meant.`;
  }, [initialDepositPennies, sentTotal, totals.total]);

  // Parsed against the LIVE total, so editing a line re-validates the deposit:
  // a £500 deposit on a £740 job becomes invalid the moment the job drops to
  // £400, and the trade is told while the figure is still on screen.
  const depositParse = useMemo(
    () => parseDeposit(depositText, Math.round(totals.total * 100)),
    [depositText, totals.total],
  );

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setSaved(false);
    setDirty(true);
    setSaveError(null);
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
    setSaveError(null);
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
    setSaveError(null);
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Everything "Save changes" persists. The customer details used to reach the
  // server only through `sendQuote`, so typing a name, email, phone or address
  // and pressing Save reported "Saved" and lost all four on reload (13 Sep).
  const customerPayload = () => ({
    name: customerName,
    email: customerEmail || undefined,
    phone: customerPhone || undefined,
    address: siteAddress || undefined,
    smsOptOut: smsOptOut || undefined,
  });

  const save = () => {
    setSaveError(null);
    startTransition(async () => {
      try {
        await updateQuoteLineItems({ jobId, quoteId, lineItems, customer: customerPayload(), depositPennies: depositParse.ok ? depositParse.pennies : undefined });
        setSaved(true);
        setDirty(false);
        setSavedItems(lineItems);
        markCustomerSaved();
      } catch (err) {
        // Never fail silently — surface it so the contractor can retry
        // rather than assuming their edits were saved.
        //
        // AND SAY WHY. This read "check your connection and try again" for
        // every failure, including the two that no amount of retrying fixes:
        // a quote locked because a contract has been raised from it, and one
        // the customer has already declined. The contractor blames their
        // signal and retries something that cannot work, while the editor goes
        // on displaying the rejected figures beside a total that is really
        // something else. The server already throws the authored reason
        // (actionableError(editability.reason)); this used to discard it.
        setSaveError(saveFailureMessage(err));
      }
    });
  };

  // A £0 total with no unresolved-rate flag is a deliberate zero — a goodwill
  // callout, a warranty visit. The server asks rather than refuses, and this
  // holds the ask until the contractor answers it. Blocking a legitimate £0
  // quote would create a support problem that never arrives as a bug report.
  // Switching to a fixed price REPLACES the itemised lines with a single works
  // line. Since #730 that is reversible — the switch records what it collapsed —
  // but it is still a restructure of the whole quote fired by one unguarded
  // click, on a control sitting beside "Save changes". Reported 13 Sep, where it
  // was also destructive; this is the other half of that report.
  //
  // Only asked when there is something to lose: a quote with no priced lines has
  // nothing to collapse, and a contractor who has already switched once should
  // not be asked again on the way back.
  const [confirmingFixedSwitch, setConfirmingFixedSwitch] = useState(false);
  const [confirmingZeroTotal, setConfirmingZeroTotal] = useState(false);

  // The quote's own Scope of work names a price the priced figures don't
  // support. Same posture as the £0 question: the server asks, this holds the
  // ask, and the contractor decides. Carries both figures so they can see which
  // one is wrong rather than being told only that something is.
  const [confirmingNarrative, setConfirmingNarrative] =
    useState<NarrativeConfirmDetail | null>(null);

  // The quote exceeds the Pay by Bank limit (£10,000) and needs confirmation
  // before sending. Carries the total so the dialog can show the actual amount.
  const [confirmingOverCeiling, setConfirmingOverCeiling] =
    useState<OverCeilingConfirmDetail | null>(null);

  // Reconciliation failure from PRICE-4: the per-amount gate has blocked send
  // because stated amounts don't match rendered lines or lines are unsourced.
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  // The stated-price mismatch is held separately from reconciliationError
  // because it is the one kind with a RESOLUTION rather than an edit: both
  // figures are known, and each has a control that already exists.
  const [resolvingMismatch, setResolvingMismatch] = useState<
    { stated: number; priced: number } | null
  >(null);

  // All three questions can be asked in turn on one send — the checks run in
  // sequence, so answering one may reveal another. Answering a later question
  // must not un-answer an earlier one, so the answers accumulate here instead
  // of living only in the argument.
  const confirmed = useRef({ zeroTotal: false, narrativeMismatch: false, overCeiling: false });

  const send = (confirm: Partial<typeof confirmed.current> = {}) => {
    confirmed.current = { ...confirmed.current, ...confirm };
    setSendResult(null);
    setConfirmingZeroTotal(false);
    setConfirmingNarrative(null);
    setConfirmingOverCeiling(null);
    setReconciliationError(null);
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
            await updateQuoteLineItems({ jobId, quoteId, lineItems, customer: customerPayload(), depositPennies: depositParse.ok ? depositParse.pennies : undefined });
            setSaved(true);
            setDirty(false);
            setSavedItems(lineItems);
            markCustomerSaved();
          } catch (err) {
            setSaveError(saveFailureMessage(err));
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
          confirmOverCeiling: confirmed.current.overCeiling,
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
        // Read the message through actionableMessage, never off err.message:
        // a production build redacts the message of anything a Server Action
        // rejects with, so every match below silently failed on motko.app and
        // the questions this branch exists to ask were shown as React's
        // "specific message is omitted" notice instead.
        const message = actionableMessage(err);
        // Not a failure: the server is asking whether the zero is deliberate.
        // Surface the question in place rather than as an error.
        if (message?.includes(ZERO_TOTAL_CONFIRM_REQUIRED)) {
          setConfirmingZeroTotal(true);
          return;
        }
        // Also a question, not a failure: the document contradicts itself and
        // the contractor is the only one who knows which figure is right.
        const narrativeConfirm = message ? parseNarrativeConfirm(message) : null;
        if (narrativeConfirm) {
          setConfirmingNarrative(narrativeConfirm);
          return;
        }
        // Also a question: the quote exceeds the Pay by Bank limit and the
        // contractor needs to acknowledge that large jobs use staged payment.
        const overCeilingConfirm = message ? parseOverCeilingConfirm(message) : null;
        if (overCeilingConfirm) {
          setConfirmingOverCeiling(overCeilingConfirm);
          return;
        }
        // The stated fixed price disagrees with the priced lines. Unlike the
        // three below it this is not an edit — both figures are known and each
        // has a control that already exists, so it gets a resolution.
        //
        // It used to match NONE of the branches here and fell through to
        // setSendResult, which renders a bare error with no action. That is the
        // dead end Jacob hit on 9 Sep: send, read "you set £1800.00, but the
        // priced lines come to £2200.00", press send again, read it again.
        // Sentry JAVASCRIPT-NEXTJS-A. The controls were on the same screen the
        // whole time; nothing connected the message to them.
        const statedMismatch = message ? parseStatedPriceMismatch(message) : null;
        if (statedMismatch) {
          setResolvingMismatch(statedMismatch);
          return;
        }
        // Reconciliation gate failure (PRICE-4): stated amounts don't match
        // rendered lines or lines are unsourced. Show the review screen.
        if (
          message &&
          (message.includes("Unsourced line") ||
            message.includes("Amount mismatch") ||
            message.includes("Duplicate amount"))
        ) {
          setReconciliationError(message);
          return;
        }
        haptics.error();
        setSendResult({ error: message ?? unexpectedSendFailure(err) });
      } finally {
        if (sendSlowTimer.current) {
          clearTimeout(sendSlowTimer.current);
          sendSlowTimer.current = null;
        }
        setSendSlow(false);
      }
    });
  };

  // Mark all unsourced lines as contractor-sourced and retry send.
  // This is the resolution path for the PRICE-4 reconciliation gate when
  // the contractor confirms that lines without transcript provenance are
  // intentional additions.
  const confirmContractorSourced = () => {
    setReconciliationError(null);
    startSending(async () => {
      try {
        // Mark all lines without provenance as contractor-sourced
        const updatedLineItems = lineItems.map((line) =>
          !line.provenance || !line.provenance.source
            ? { ...line, provenance: { source: "contractor" as const } }
            : line,
        );

        // Persist the provenance updates
        await updateQuoteLineItems({ jobId, quoteId, lineItems: updatedLineItems });
        setLineItems(updatedLineItems);
        setDirty(false);
        setSavedItems(updatedLineItems);

        // Retry the send with the updated provenance
        send({});
      } catch (err) {
        haptics.error();
        setSendResult({
          error: actionableMessage(err) ?? unexpectedSendFailure(err),
        });
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
              onClick={() =>
                totals.subtotal > 0
                  ? setConfirmingFixedSwitch(true)
                  : switchPricingMode("fixed")
              }
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
          <p className="text-sm text-error">{switchError}</p>
        )}
      </Card>

      {/* Line items — the reason this page exists. */}
      <div className="flex flex-col gap-3">
        {lineItems.map((item, index) => {
          const flags = lineFlags(item.description);
          const open = openRow === index;
          return (
            <Card key={index} className="flex flex-col gap-3">
              {/* The row as a READING surface first. Description, then what it
                  is made of in mono, then the money — the three things you
                  check when scanning a quote before sending it. The whole
                  header is the control that opens the row, so the target is
                  the row rather than a chevron. */}
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenRow(open ? null : index)}
                className="-m-1 flex min-h-11 items-start justify-between gap-3 rounded-control p-1 text-left hover:bg-card-hover"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {item.description || "Untitled line"}
                    </span>
                    {item.assumed && (
                      /* One chip on the row, one footnote under the group —
                         replacing a per-row sentence that repeated the word
                         "confirm" and prefixed every materials line with
                         "Assumed — Estimated…".

                         TWO CHIPS, BECAUSE THEY ARE TWO DIFFERENT STATES. An
                         assumed line carrying a figure IS an estimate. An
                         assumed line at £0.00 is not: it is the app REFUSING to
                         invent a price because nothing the contractor confirmed
                         says what it costs, which is the PFIX-4 rule working.
                         Calling that an estimate says we guessed, and £0.00
                         then reads as "included" — reported live on 22 Sep as
                         "the plaster cost is estimated 0 which is weird", on a
                         plastering quote whose finishing plaster showed
                         "Est. £0.00 / 3 bag @ £0.00".

                         "Not priced" is the app's own word for this state
                         already — see UNCONFIRMED_ESTIMATE_PREFIX and
                         UNSOURCED_PRICE_FLAG in compile-draft.ts. */
                      <span className="rounded-pill bg-amber-tint px-2 py-0.5 text-xs font-semibold text-amber-ink">
                        {lineItemTotal(item) === 0 ? "Not priced" : "Est."}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-ink-secondary">
                    {item.quantity} {item.unit} @ {formatGBP(displayedUnitRate(item))}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-medium text-ink">
                  {formatGBP(lineItemTotal(item))}
                </span>
              </button>

              {open && (
                <>
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
              {/* WHAT KIND OF LINE THIS IS.
                  Every hand-typed line was created as `category: "other"` with
                  no way to change it, so a typed quote reached the contract
                  carrying no categories at all. The contract's clause 2 splits
                  the price into Labour and Materials from exactly this field,
                  so the whole quote landed in one row and the other read
                  £0.00 — as Materials before 13 Sep and as Labour after, the
                  bucket flipping while the underlying gap stayed open.
                  No derivation can be right while the data is absent, so this
                  asks. Voice-drafted lines already carry a category and are
                  untouched. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
                  Kind
                  <select
                    aria-label={`Line item ${index + 1} kind`}
                    value={item.category}
                    onChange={(e) =>
                      updateItem(index, {
                        category: e.target.value as LineItem["category"],
                      })
                    }
                    className="min-h-11 rounded-control border border-border bg-card px-2 py-1 text-sm text-ink"
                  >
                    <option value="labour">Labour</option>
                    <option value="materials">Materials</option>
                    <option value="travel">Travel</option>
                    <option value="callout">Call-out</option>
                    <option value="other">Other</option>
                  </select>
                </label>
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
                  label="Cost (£)"
                  type="number"
                  value={item.unit_price}
                  onChange={(e) => updateItem(index, { unit_price: Number(e.target.value) })}
                />
                {/* "Multiplier" is developer language — no electrician knows
                    what to put in it. LABEL ONLY: the persisted field, its
                    value and every reader of it (quote-math, quote-learning)
                    are untouched, so 1.5 still means 1.5. The helper below
                    says what that is in the only terms that matter. */}
                <Input
                  label="Markup"
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
              {/* THE HINT HAS TO ARRIVE BEFORE THE MISTAKE, NOT AFTER IT.
                  This line used to render only when the value had already been
                  changed, so at the default of 1 the field stated no unit at
                  all. Setup asks for "Materials markup (%)", so a trade who
                  has just filled that in types 20 here meaning 20% — and 20 is
                  a valid multiplier, so a £260 ceiling skim silently became
                  £5,200. The warning was correct and appeared too late to be
                  a warning.
                  At the default it teaches the unit with an example; once
                  changed it reports what the entered value actually does.
                  Label and helper only — the persisted field, its value and
                  every reader (quote-math, quote-learning) are untouched. */}
              <p className="text-sm text-ink-secondary">
                {item.multiplier === 1
                  ? "1.2 = 20% on top of cost"
                  : `${item.multiplier} = ${Math.round((item.multiplier - 1) * 100)}% on top of cost`}
              </p>
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
              <Input
                label="Customer note (shows on the quote)"
                value={item.customer_note ?? ""}
                onChange={(e) =>
                  updateItem(index, { customer_note: e.target.value || undefined })
                }
              />
                </>
              )}
            </Card>
          );
        })}
        {lineItems.some((item) => item.assumed && lineItemTotal(item) > 0) && (
          /* Said once, under the group, instead of once per row. */
          <p className="text-sm text-ink-secondary">
            {/* Was "confirm against supplier price", which is only true of
                materials. Labour lines are marked Est. too now, when the call
                never captured how long the job takes, and there is no supplier
                price to check those against. */}
            Items marked Est. are estimates — check each one before sending.
          </p>
        )}
        {lineItems.some((item) => item.assumed && lineItemTotal(item) === 0) && (
          /* Its own sentence, because it is its own problem. The estimates
             note says "check each one" — advice that makes no sense about a
             line carrying no figure to check. This one names the consequence
             instead, which is the part a contractor cannot see: the line is on
             the quote, and it is charging nothing. */
          <p className="text-sm text-ink-secondary">
            Items marked Not priced have no price yet — they&apos;re on the quote at
            £0.00 until you enter one.
          </p>
        )}
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
              // LABOUR, NOT OTHER. The Kind field exists so a typed quote
              // carries categories, but its default decided what most quotes
              // actually say — and "other" is never the right answer, only the
              // unanswered one. It put "Other works £1,000.00" on the contract
              // clause the customer signs, filed a plastering quote under
              // "OTHER" in the PDF, and left clause 2 with a single bucket, so
              // the price breakdown was withheld entirely (it is withheld by
              // design when one bucket is used — that rule is correct and is
              // not what changes here; what changes is that the common path
              // stops collapsing to one bucket).
              //
              // Labour is the ordinary first line of a trade's quote, and it is
              // right far more often than it is wrong. The field sits in plain
              // view on the line, so a materials line is one click to correct —
              // which is not true of a default nobody is prompted to revisit.
              category: "labour",
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
        {/* THE ROW FOLLOWS THE MONEY, not the setting — the same gate /q/[id],
            the job page and the quote PDF now use.
            Driving it from `vatRegistered` while the figures came from the
            record made the two disagree in both directions: an unregistered
            trade's quote printed "VAT (20%) £0.00", asserting a registration
            that does not exist; and a registered quote read with the flag off
            lost its VAT line while keeping its VAT-inclusive total, leaving an
            unexplained £533.38 between the subtotal and the total. */}
        {totals.vat > 0 && (
          <div className="flex justify-between">
            <span className="text-text-secondary">VAT (20%)</span>
            <span className="tabular-nums">{formatGBP(totals.vat)}</span>
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold tabular-nums">{formatGBP(totals.total)}</span>
        </div>

        {/* ASK FOR THE DEPOSIT HERE, under the total it is a proportion of.
            Deposits existed only as a percentage typed on the contract AFTER
            the customer had accepted — which is why two of the seven live ones
            are at 1% of a £7-8k job, £72 and £81, figures entered to clear a
            required field. Asking at the price is what makes it a term of the
            quote rather than an afterthought.
            An empty field is no deposit and stays the default: this adds a
            question, it does not add a step. */}
        <div className="mt-4 border-t border-line pt-4">
          <Input
            label="Deposit (optional — £ or %)"
            value={depositText}
            inputMode="text"
            placeholder="e.g. 25% or £500"
            onChange={(e) => {
              setDepositText(e.target.value);
              setSaved(false);
              setDirty(true);
              setSaveError(null);
            }}
          />
          {depositParse.ok ? (
            depositParse.pennies ? (
              <p className="mt-1.5 text-sm text-ink-secondary">
                {formatGBP(depositParse.pennies / 100)} due when they accept,{" "}
                {formatGBP(totals.total - depositParse.pennies / 100)} on completion.
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-ink-secondary">
                No deposit — the full amount is invoiced on completion.
              </p>
            )
          ) : (
            <p className="mt-1.5 text-sm text-error">{depositParse.error}</p>
          )}
        </div>
      </div>

      {willWithdrawAcceptance && (
        <div
          role="status"
          className="rounded-md border border-amber bg-amber-tint p-3 text-sm text-amber-ink"
        >
          <p>{EDIT_AFTER_ACCEPT_WARNING}</p>
          {depositShareNotice && <p className="mt-2">{depositShareNotice}</p>}
        </div>
      )}

      {/* An accepted quote already says the stronger thing above, so the
          sent-quote warning would only repeat half of it. */}
      {willDiverge && !willWithdrawAcceptance && (
        <div
          role="status"
          className="rounded-md border border-amber bg-amber-tint p-3 text-sm text-amber-ink"
        >
          <p>{EDIT_AFTER_SEND_WARNING}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {/* The visible half of the auto-save decision. Auto-save was withdrawn
            because the `dirty` guard that aborts a send on a failed persist
            outranks the friction argument — so the answer is to make the
            pending state impossible to miss, not to remove the button. Amber,
            because unsaved work is the contractor's move. */}
        {dirty && unsavedCount > 0 && !isPending && (
          <p className="flex items-center gap-2 text-sm text-amber-ink">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-pill bg-amber" />
            {unsavedCount} unsaved {unsavedCount === 1 ? "change" : "changes"}
          </p>
        )}
        <Button type="button" variant="secondary" onClick={save} disabled={isPending}>
          {isPending
            ? "Saving..."
            : saveError && failureIsRetryable(saveError)
              ? "Try again"
              : saved
                ? "Saved"
                : "Save changes"}
        </Button>
        {saveError && (
          <p className="text-sm text-error">{saveError}</p>
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
              // These count as unsaved work like any line edit. They did not,
              // so the amber "N unsaved changes" line stayed silent while a
              // typed name sat unpersisted (13 Sep).
              setDirty(true);
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
              // These count as unsaved work like any line edit. They did not,
              // so the amber "N unsaved changes" line stayed silent while a
              // typed name sat unpersisted (13 Sep).
              setDirty(true);
              clearVoiceHint("email");
            }}
            type="email"
          />
          {renderVoiceHint("email")}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="Customer mobile"
            value={customerPhone}
            onChange={(e) => {
              setCustomerPhone(e.target.value);
              // These count as unsaved work like any line edit. They did not,
              // so the amber "N unsaved changes" line stayed silent while a
              // typed name sat unpersisted (13 Sep).
              setDirty(true);
              clearVoiceHint("phone");
            }}
            type="tel"
          />
          {renderVoiceHint("phone")}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="Site address"
            value={siteAddress}
            onChange={(e) => {
              setSiteAddress(e.target.value);
              // These count as unsaved work like any line edit. They did not,
              // so the amber "N unsaved changes" line stayed silent while a
              // typed name sat unpersisted (13 Sep).
              setDirty(true);
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
        {confirmingFixedSwitch && (
          <div className="flex flex-col gap-2 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">
              Replace the itemised lines with one fixed price?
            </p>
            <p className="text-xs text-text-secondary">
              {`The ${
                lineItems.length === 1 ? "line" : `${lineItems.length} lines`
              } totalling ${formatGBP(
                totals.subtotal,
              )} will be collapsed into a single works line, seeded at that figure for you to adjust. Switching back to itemised brings them again.`}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => {
                  setConfirmingFixedSwitch(false);
                  switchPricingMode("fixed");
                }}
                disabled={switching}
              >
                {switching ? "Switching…" : "Yes, use a fixed price"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingFixedSwitch(false)}
                disabled={switching}
              >
                Keep the itemised lines
              </Button>
            </div>
          </div>
        )}
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
        {confirmingOverCeiling && (
          <div className="flex flex-col gap-2 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">
              This quote is over £10,000. Send it anyway?
            </p>
            {confirmingOverCeiling.total != null ? (
              <p className="text-xs text-text-secondary">
                At <strong>{formatGBP(confirmingOverCeiling.total)}</strong>, this
                job will use the staged payment path — the customer pays in
                instalments as work progresses, which is how larger jobs are handled.
              </p>
            ) : (
              <p className="text-xs text-text-secondary">
                This job will use the staged payment path — the customer pays in
                instalments as work progresses, which is how larger jobs are handled.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => send({ overCeiling: true })}
                disabled={isSending}
              >
                Yes, send it
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingOverCeiling(null)}
                disabled={isSending}
              >
                Go back
              </Button>
            </div>
          </div>
        )}
        {/* THE WAY OUT of a stated-price mismatch.

            Both figures are known and each has a control that already existed —
            the fixed-price input above, and the mode switch beside it. What was
            missing was any connection between the refusal and them, so the
            contractor read the same sentence on every press.

            Deliberately NOT a "send anyway" confirm, unlike the zero-total,
            narrative and over-ceiling guards. Sending with two stored figures
            that disagree is exactly what produced the £5,000 SoW against a £5.00
            works line, accepted at £6.00 gross. The disagreement has to be
            resolved, not acknowledged — so both buttons here change the quote
            and neither bypasses the guard. */}
        {resolvingMismatch && (
          <div className="flex flex-col gap-3 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">Which price is right?</p>
            <p className="text-xs text-text-secondary">
              The fixed price on this job is {formatGBP(resolvingMismatch.stated)}, but the
              priced lines come to {formatGBP(resolvingMismatch.priced)}. Pick one before
              sending — the customer sees a single figure either way.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={switching || isSending}
                onClick={() => {
                  setResolvingMismatch(null);
                  switchPricingMode("fixed", resolvingMismatch.priced);
                }}
              >
                {switching
                  ? "Updating…"
                  : `Charge ${formatGBP(resolvingMismatch.priced)}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={switching || isSending}
                onClick={() => {
                  setResolvingMismatch(null);
                  switchPricingMode("calculated");
                }}
              >
                Show the itemised breakdown instead
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={switching || isSending}
                onClick={() => setResolvingMismatch(null)}
              >
                Go back and edit
              </Button>
            </div>
          </div>
        )}

        {reconciliationError && (
          <div className="flex flex-col gap-3 rounded-card border border-warning bg-warning/5 p-4">
            <p className="text-sm font-medium">
              This quote needs review before sending
            </p>
            <div className="flex flex-col gap-2 text-xs text-text-secondary">
              {reconciliationError.split(" Unsourced line:").filter(Boolean).map((msg, i) => (
                <p key={`unsourced-${i}`}>
                  Unsourced line:{msg.split(" Amount mismatch:")[0].split(" Duplicate amount:")[0]}
                </p>
              ))}
              {reconciliationError.includes("Amount mismatch") &&
                reconciliationError.split(" Amount mismatch:").slice(1).map((msg, i) => (
                  <p key={`mismatch-${i}`}>Amount mismatch:{msg.split(" Unsourced line:")[0].split(" Duplicate amount:")[0]}</p>
                ))}
              {reconciliationError.includes("Duplicate amount") &&
                reconciliationError.split(" Duplicate amount:").slice(1).map((msg, i) => (
                  <p key={`duplicate-${i}`}>Duplicate amount:{msg.split(" Unsourced line:")[0].split(" Amount mismatch:")[0]}</p>
                ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {!reconciliationError.includes("Amount mismatch") &&
                !reconciliationError.includes("Duplicate amount") && (
                  <Button
                    type="button"
                    onClick={confirmContractorSourced}
                    disabled={isSending}
                  >
                    Confirm as contractor-sourced
                  </Button>
                )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setReconciliationError(null)}
                disabled={isSending}
              >
                Go back and edit
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
