# End-to-end run, 19 Aug 2026 — investigation and specs

**Audited:** branch `claude/e2e-findings-investigation-dyt1k8` @ `1951306`
("LED-6: Voice query over the ledger (#278)"), which is `origin/main`'s tip
lineage. Working tree clean at time of audit.

**`/areas/motko.md` — NOT FOUND.** Searched the repo (`find / -name motko.md`),
the Notion workspace (search for the area doc), and Google Drive (`title
contains 'motko'`). No such file or page exists in any surface reachable from
this session. Every decision cited below is therefore sourced from the
codebase, from Notion roadmap/bugs cards, or from `CLAUDE.md` / `AGENTS.md`.
Where a conflict with `/areas/motko.md` might exist, I could not check it.

---

# 1. Investigation report

## FINDING 1 — Scope of works is discarded from the customer-facing quote

**Diagnosis: CONFIRMED, and the real defect is larger than stated.**

The derived scope of works is persisted, richly structured, and rendered
beautifully — onto a document the customer never receives.

- **Where it lives.** `jobs.sow_json`, typed by `sowStateSchema`
  (`src/lib/schemas/sow.ts:105-182`). It carries `rooms[]` (each with
  `dimensions` and `work_items`), `inclusions`, `exclusions`,
  `additional_items`, `existing_conditions`, `access_issues`,
  `materials_mentioned`, `materials_supply`, `assumptions_and_unknowns`, and
  `overview_narrative` — "a short narrative paragraph summarising the job and
  its assumptions in plain language" (line 155-157).
- **The timeline string is generated here.** `synthesizeTimeline`
  (`src/lib/schemas/sow.ts:646-673`) produces exactly the observed phrasing:
  `Approx. ${durationDays} working day(s)` + `${peopleCount}-person team`,
  joined with ", ". So `"Approx. 3 working days, 1-person team"` is this
  function's output verbatim.
- **It reaches a PDF — the wrong one.** `SowPdf`
  (`src/lib/pdf/sow-pdf.tsx:103-302`) renders all of it: an "Overview" section
  from `overview_narrative`, a "Scope of work" section per room, "Additional
  work", "Existing conditions", "Access & working constraints", "Included &
  not included", "Materials", "Assumptions", and a `Timeline` meta cell
  (line 121) fed by `synthesizeTimeline`.
- **That PDF is contractor-only.** `src/app/api/jobs/[id]/sow-pdf/route.ts:28-49`
  states it outright: *"The SOW is an internal contractor document (not a
  customer-facing capability URL like the quote/contract PDFs), so this route
  is authenticated and tenant scoped."* It is served only from two links on the
  contractor's own job page (`src/app/jobs/[id]/page.tsx:313` and `:557`).

**The quote PDF has no scope-of-works block at all — only line items and
totals.** `QuotePdfPayload` (`src/lib/pdf/quote-payload.ts:20-43`) has exactly
these fields: `reference`, `createdAt`, `lineItems`, `jobType`, `contractor`,
`customer`. There is no scope, no timeline, no assumptions, no
inclusions/exclusions field. `QuotePdf` (`src/lib/pdf/quote-pdf.tsx:100-278`)
renders header → parties → `MetaRow` (`jobType`, `Reference`, `Date`, lines
126-130) → line-item table → totals → footer. Nothing else.

`quoteRowToPdfPayload` (`src/lib/pdf/render-quote.ts:38-68`) confirms the drop
at the data layer: its Supabase select (line 78) reads
`created_at, line_items_json, job:jobs(extracted_json, customer, contractor)`
— **it never selects `sow_json`.** The scope of works is not lost in
rendering; it is never loaded.

**The "as described" phrase is a deterministic fallback stub, not LLM prose.**
`deriveWorksDescription` (`src/lib/pricing-mode.ts:18-23`):

```ts
export const deriveWorksDescription = (jobType: string): string => {
  const trimmed = jobType.trim();
  if (trimmed === "") return "Works as described";
  const sentenceCased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${sentenceCased} works as described`;
};
```

**Trigger condition:** it fires only in **fixed-price mode**.
`applyPricingMode` (`src/lib/pricing-mode.ts:57-76`) returns the full
calculated breakdown for `days` / `calculated` / legacy-null modes, and only
for `mode === "fixed" && fixedAmount != null` does it call
`buildFixedModeLineItems(deriveWorksDescription(sow.job_type), …)` (line 73),
which collapses the quote to **one** line item at the stated net figure
(`src/lib/pricing-mode.ts:29-48`), plus any provisional sums.

So the observed single line `"Rewire works as described"` is: fixed-price mode
+ `job_type === "rewire"`. The word "described" refers to the SoW — which the
quote PDF does not carry and the customer was never sent.

**Itemised mode checked separately, as asked.** In `days`/`calculated` mode the
customer gets per-line descriptions from the drafter, plus `includes_tasks`
sub-bullets and `customer_note` (`quote-pdf.tsx:191-219`). That is materially
better, but it is still a priced table with **no** scope narrative, no
timeline, no inclusions/exclusions and no assumptions. The defect is present in
both modes; fixed mode makes it total.

**Guest mode drops it too.** `GuestQuote` (`src/lib/guest/quote.ts:23-42`) has
no scope field, and `guestQuoteToPdfPayload` (`src/lib/guest/pdf.ts:9-16`)
builds the same six-field payload. Guest SoW state is in-memory only.

---

## FINDING 2 — Contract step does not fan out to SMS

**Diagnosis: CONFIRMED. The mechanism is worse than "preference not consulted":
SMS capability does not exist for contract or invoice at all.**

`src/lib/sms.ts` exports exactly two senders: `sendQuoteSms` (line 15) and
`sendChaseSms` (line 75). There is no `sendContractSms` and no
`sendInvoiceSms`. `src/lib/email.ts` exports six: quote (40), invoice (82),
contract (126), contractor-notification (173), account-deletion (212),
chase (254).

### Every customer-facing lifecycle send site

| Lifecycle event | Site | Channels dispatched | Consults the stored signal? |
|---|---|---|---|
| Quote sent | `src/app/jobs/actions.ts:973-1032` | email **+ SMS**, in parallel, independently timed out | Yes — `channels` from the editor, and `customer.smsOptOut` (line 953) |
| **Contract sent** | `src/app/dashboard/actions.ts:179-190` | **email only** | No — no SMS branch exists |
| **Invoice sent** (manual *and* auto deposit-on-signature) | `src/lib/invoicing.ts:83-93` | **email only** | No — no SMS branch exists |
| Contract-signed confirmation to the customer | — | **none — no send exists** | n/a |
| Payment receipt to the customer | — | **none — no send exists**; only the `/i/[id]/paid` page | n/a |
| Overdue chase / reminder | `src/app/api/cron/chase/route.ts:143-178` | email **+ SMS** | Yes — `contact.sms_opt_out !== true` (line 145) |
| Contractor notification (accepted/signed/declined/paid) | `src/lib/notify-contractor.ts:39-58` | email **+ push**; no SMS | n/a (contractor side) |

**There is no dispatcher.** Each site does its own thing inline. The contract
send is fourteen lines of `if (email) { … }` inside `createContract`; the
invoice send is eleven lines inside `createInvoiceRecord`; the quote send is a
60-line bespoke harness with `withTimeout`, independent per-channel error
logging, and an idempotent `markSent`. Only the quote path has any of that
rigour, and none of it is reusable.

**The `AGENTS.md` anti-pattern, precisely.** The signal exists and is trusted:
`customers.contact.sms_opt_out` is written by `sendQuote`
(`src/app/jobs/actions.ts:909`) and by the inbound Twilio STOP handler via the
`set_sms_opt_out` RPC (`src/app/api/twilio/inbound/route.ts:46`,
`supabase/migrations/00000000000031_set_sms_opt_out.sql`). Two of the five
customer-facing lifecycle sends never consult it — because they have no SMS
path to gate. A regulatory opt-out signal is captured, stored atomically,
honoured at two sites, and structurally unreachable at two others.

**Note on the finding's wording.** "Customer channel preference appears to be
set once and then consulted at some send sites" is half right. There is no
positive stored channel *preference* — only a negative `sms_opt_out` flag. The
positive choice (`channels: {email, sms}`) is per-send UI state in the quote
editor (`src/app/jobs/[id]/quote-editor.tsx:215-216, 335`), defaulting both to
`true`, and it dies when that form unmounts. Nothing else in the lifecycle can
read it.

---

## FINDING 3a — The payment pending page is terminal

**Diagnosis: CONFIRMED.**

`src/app/i/[id]/paid/page.tsx:33-118` is an `async` server component with no
client component, no `useEffect`, no polling, no `revalidate`, and no redirect.
It reads the invoice once at request time and computes:

```ts
const settled = invoice?.status === "paid" || invoice?.paid_at != null;  // line 62
```

If `settled` is false it renders the "Payment pending" block (lines 98-113) and
stops. Nothing on the page can ever change that state. The only escape is the
customer manually reloading, and nothing tells them to.

**Why it is reached at all — and this is correct behaviour, deliberately
chosen.** The file's header comment (lines 9-16) is explicit: Stripe redirects
here "as soon as the customer returns from their bank — before the
`payment_intent.succeeded` webhook has settled anything". Settlement is
webhook-driven (`src/app/api/stripe/webhook/route.ts:89-116` →
`settlePaidJob`). The page refusing to claim payment it cannot see is right.
The page never resolving is the bug.

**Compounding defect — the intermediate states are logged, not persisted.**
`payment_intent.processing` (`webhook/route.ts:120-127`) and
`payment_intent.payment_failed` (`:129-136`) each `console.log` and return
`{received: true}`. Neither writes anything to the database. So there is no
stored state distinguishing *processing* from *failed* from *abandoned* — even
a polling page would have nothing to poll for except `status === "paid"`. This
is the `AGENTS.md` rule verbatim: *"A signal that must change behaviour cannot
terminate in telemetry."* A failed payment is a signal that must change what
the customer is told, and it terminates in `console.log`.

**PAY-7 does NOT cover this — checked, not a duplicate.**
[PAY-7](https://app.notion.com/p/3bd1e4f908b48135a72acbc641f7de24) (Roadmap,
Module `payments`, Status **Blocked**, issue #239) is about *contractor-side
fee collection where there is no live customer payment to attach an
`application_fee_amount` to*. Its acceptance criteria section does not exist —
it is explicitly a decision card ("this card is a decision, not an
implementation", "Do not queue to the factory"). Its Out of scope says "**No
customer-facing change of any kind — this is contractor-side only.**" It
touches nothing in Finding 3a.

**Possible overlap flagged, not silently duplicated.** The Bugs DB has *"Pay by
bank does not work"* (Module `payment`, Status **Needs spec**,
[link](https://app.notion.com/p/3ba1e4f908b480b5890df503e05f18b0)). Its body is
a single screenshot with no text, so I cannot confirm whether it reports this
same defect. See the DECISION NEEDED block in §4.

---

## FINDING 3b — "It opened in Safari, not the app"

**Diagnosis: REFUTED at every layer that is checkable in this codebase. No
ticket.**

The brief asked me to confirm whether the Stripe return URL path is in the AASA
file, and said that if it is not, that is a separate ticket. **It is.**

1. **The return URL.** `src/app/i/[id]/pay-button.tsx:56` —
   `return_url: \`${window.location.origin}/i/${invoiceId}/paid\``.
2. **The AASA file.** `public/.well-known/apple-app-site-association.json`
   declares `appID` `PLFZC3LK8F.app.motko.ios` with
   `paths: ["/i/*/paid", "/settings"]`. The return URL matches `/i/*/paid`.
3. **It is served correctly.**
   `src/app/.well-known/apple-app-site-association/route.ts:5-17` serves it at
   the extensionless path with `Content-Type: application/json`.
4. **The entitlement is present.** `ios/App/App/App.entitlements` declares
   `com.apple.developer.associated-domains` → `applinks:motko.app`.
5. **The in-app handler exists.**
   `src/components/native-app-init.tsx:176-197` handles `appUrlOpen` and
   navigates the WKWebView to the incoming path.

Every layer this repository controls is correct. The remaining explanations —
iOS does not fire a universal link for a navigation arriving through a
server-redirect chain the user did not directly tap, and Safari's per-domain
"open in browser" stickiness once a user has chosen it — are runtime behaviours,
not defects in this tree. There is nothing here to spec, and writing a spec
against a correct AASA file would be exactly the template diagnosis the brief
forbids.

**Note on framing:** the customer-facing payment page is *designed* as a public
web capability URL. A customer has no reason to have the app installed, and
landing in Safari is the intended path for them. The observed run was Jacob
paying his own test invoice on a device that happens to have the app. See the
DECISION NEEDED block in §4 for the one real product question this leaves.

---

## FINDING 4 — Internal template annotation renders in the customer contract

**Diagnosis: CONFIRMED as a defect; the stated *mechanism* is REFUTED.**

The brief hypothesised template metadata being passed through by the renderer,
and directed me to "keep the field in the template object … and stop the
renderer emitting it". **There is no such field.** `"Use for:"` is literal
markdown text baked into the `body` string of all five templates.

`ContractTemplateDefinition` (`src/lib/contracts/templates.ts:523-528`) is:

```ts
{ key: ContractTemplateKey; label: string; description: string; body: string }
```

`renderContractTemplate` (`src/lib/contracts/render-template.ts:9-13`) takes
`(body, variables)` — the body string alone, never the object. It does
`{{#section}}` and `{{var}}` substitution and nothing else. It cannot leak a
field it is never given.

**The actual leak.** Every one of the five template bodies opens with a
three-line authoring preamble inside the template literal:

```
# Contract for Small Works

**Use for:** single-visit or low-value jobs, paid on completion (…).
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use.*

---
```

At `templates.ts` lines **10-11** (small works), **98-99** (standard project),
**210-211** (large/staged), **327-328** (regulated/certified) and **431-432**
(maintenance/recurring). Because it is body text, `parseContractMarkdown`
(`src/lib/contracts/markdown.ts:49+`) parses it as an ordinary bold paragraph
and an italic paragraph, and both the contract PDF and the public `/c/[id]`
page render it to the customer.

**Answering "are there other metadata fields that could leak the same way?" —
no, and the inverse is true.** `description`
(`templates.ts:530-560`) is the genuine authoring/selection field. It is
rendered only in the contractor's template picker
(`src/app/dashboard/create-contract-form.tsx:293`) and never reaches customer
output. It already carries the same information as the `**Use for:**` line, in
shorter form. So the `**Use for:**` line is a **duplicate of an existing
non-rendering field** — which is why deleting it costs nothing.

The two lines are not equivalent and must be handled differently:

- `**Use for:**` — purely internal selection guidance. Delete outright;
  `description` already covers it.
- `*Jurisdiction: England & Wales. …*` — **mixed.** "Jurisdiction: England &
  Wales" is legitimate customer-facing contract content and must stay. "Draft
  template — have a solicitor review before use" is internal *and*, per the
  brief's resolved decision, now factually stale.

**A blocker the spec must clear.** `templates.ts:3-6` carries a standing
instruction: *"Verbatim legal template bodies … **Do not edit the wording** —
only the `{{variable}}` plumbing around them. Jurisdiction: England & Wales.
Draft templates — a solicitor should review before use."* Any agent picking
this up will read that and refuse. The spec must authorise the edit and update
that comment in the same change, or the item will bounce.

**Blast radius.** `rendered_body` is frozen onto the contracts row at creation
(`src/app/dashboard/actions.ts:150-170`). Editing `templates.ts` therefore
changes **new contracts only**. Every already-sent and already-signed contract
keeps the annotation. That is a deliberate edge case the spec resolves below.

---

## FINDING 5 — Contract remains editable after agreement (NOT FACTORY WORK)

**Investigation report only, as directed. No spec.**

### What the edit affordance actually does today

`QuoteEditor` is rendered on the job page **unconditionally whenever a quote
exists** — `src/app/jobs/[id]/page.tsx:708-724`, guarded only by `quote ?`. There
is no check on contract status. After signature the contractor is still looking
at a live editor with Save, Redraft and pricing-mode controls.

What happens when they use it splits three ways:

| Action | Server action | Status guard? | Effect post-signature |
|---|---|---|---|
| Edit line items → Save | `updateQuoteLineItems` (`src/app/jobs/actions.ts:753-815`) | **Yes** | Refused. `EDITABLE_STATUSES = ["draft","sent"]`, checked on read (779-782) **and** asserted in the UPDATE via `.in("status", …)` (795), with a comment naming exactly this risk: *"editing them would silently change the price behind a signed/accepted quote. Refuse rather than rewrite history."* |
| "Redraft" | `redraftJob` (`src/app/jobs/actions.ts:506-593`) | **No** | Writes `line_items_json`, `drafted_line_items_json`, `contractor_flags_json` and `total` with `.eq("job_id", jobId)` and **no status predicate** (583-591). Succeeds on a signed job. |
| Switch pricing mode / fixed amount | `setQuotePricingMode` (`src/app/jobs/actions.ts:611-672`) | **No** | Writes `jobs.sow_json` and `quotes.line_items_json` + `total` with `.eq("id", quote.id)` and **no status predicate** (669-670). Succeeds on a signed job. |

Both unguarded actions are reachable from that same editor
(`src/app/jobs/[id]/quote-editor.tsx:99` and `:136`).

### Is the signed contract immutable, or re-rendered from live data?

**Both — and that is the defect.** It is a *partially* frozen artifact:

- **Frozen:** the contract prose. `contracts.rendered_body` is written once at
  creation (`src/app/dashboard/actions.ts:167`) and both readers use the stored
  string — `src/app/c/[id]/page.tsx:44,53` and
  `src/lib/pdf/render-contract.ts:38,47`.
- **Live:** the money. Both readers join `quote:quotes(total, …)` and read
  `quotes.total` **at view time**. The customer page derives "Total quote
  value", "Deposit (n%)" and "Balance on completion" from it
  (`src/app/c/[id]/page.tsx:74,108-124`), and the PDF does the same
  (`src/lib/pdf/render-contract.ts:72` → `src/lib/pdf/contract-pdf.tsx:162,
  199-207`).

**Consequence.** A contractor who hits Redraft or changes the pricing mode after
the customer has signed changes the Total, Deposit and Balance figures on the
signed contract — for the customer, in the page they signed, and in the PDF,
under an unchanged signature block and signature date. The prose says one
thing; the money says another; nothing records that it moved.

### Does the job aggregate have any concept of a contract version?

**No.** `contracts.quote_id` carries a UNIQUE constraint
(`supabase/migrations/00000000000033_dashboard_chase_indexes.sql:9`), so there
is exactly one contract row per quote, forever. There is no version column, no
supersedes pointer, no variation table, and no contract history. The only
mutations to a contract row are the status transitions in
`src/app/c/[id]/actions.ts` (`sent` → `signed` at :47-52, `sent` → `declined`
at :101-106), both correctly guarded on the prior state.

### Severity assessment

The brief said to flag this **severity-high if** the signed contract is
re-rendered from live job data. It is, for the money figures specifically, and
via two unguarded write paths. **I am flagging it high**, with one honest
qualification: the primary edit path a contractor would reach for
(`updateQuoteLineItems`) is already correctly guarded, so this is not
wide-open — it is two specific actions that were built without the guard their
sibling has.

### Recommendation to draft (Jacob decides)

Under "the job is a ledger", a signed contract should be an immutable record
and a change should append a **variation** requiring re-signature, rather than
mutating the agreed record. That is a data-model change (a versions or
variations table, a supersedes pointer, a re-signature flow, and customer
notification) and is correctly out of factory scope until decided.

**However** — the missing status guards are *not* a product decision. They are a
defect with known-correct behaviour already written down in this codebase:
`updateQuoteLineItems:776-782,795` is the pattern, and `signContract`/
`declineContract` demonstrate the same discipline on the contract side. Adding
the same predicate to `redraftJob` and `setQuotePricingMode` is a bounded fix
that removes the integrity hole **without prejudging** the variation-vs-immutable
decision. I have written it as a separate Bugs card and kept it strictly out of
scope of the product question.

---

## FINDING 6 — Payment method labelling and the fee-bypass path

**Diagnosis: CONFIRMED, including the point the brief was least sure of.**

### Do both options appear simultaneously?

**Yes.** `buildPayPanel` (`src/app/i/[id]/pay-panel.ts:45-73`) returns
`button_with_transfer` when `railsAvailable && !exceedsLimit` (line 67), and
`src/app/i/[id]/page.tsx:149-161` renders, in one card:

- `<PayButton>` — accessible label `"Pay £8,132.00 by bank"`
  (`src/app/i/[id]/pay-button.tsx:80-87`)
- a `<details><summary>` toggle reading **"Or pay by bank transfer"** (line 155),
  revealing `<BankTransferDetails>` with sort code, account number and reference,
  each with a Copy button.

So the naming complaint is real *today*: two near-identical labels, one card
apart. Under the resolved direction they are never co-present, so — as the brief
instructs — **no separate copy ticket.**

### Always rendered, or revealed on request?

**Revealed on request, but always present in the response body.** The `<details>`
element ships the sort code and account number in the served HTML regardless of
whether the customer expands it. Any fix must remove them from the payload, not
just collapse them.

### Where else do bank details appear?

| Surface | Verdict |
|---|---|
| Customer invoice page `/i/[id]` | **Yes** — `src/app/i/[id]/page.tsx:84-86` → `BankTransferDetails` |
| **Contract PDF and `/c/[id]` page** | **Yes — second bypass surface, previously unlisted.** `src/lib/contracts/build-variables.ts:104-113` composes `bankDetails` from `payout_account_holder_name` + `payout_sort_code` + `payout_account_number` and exposes it as `{{bank_details}}`, which **all five** templates render — `templates.ts:35, 135, 250, 374, 464`. It is gated on `payout_details_complete` only, **never on rail availability.** |
| Invoice email | No — body is a "Pay now" link only (`src/lib/email.ts:99-107`) |
| Invoice PDF | **Does not exist.** `src/lib/pdf/` contains quote, contract and SoW renderers only |
| SMS | No — `sendQuoteSms`/`sendChaseSms` carry a URL only |

### Which flag does the payment page read? — the brief's `charges_enabled` premise is wrong, and the codebase says why

The page calls `canAcceptStripePayment(contractor)`
(`src/app/i/[id]/page.tsx:79`), defined at `src/lib/stripe-connect.ts:150-170`:

```ts
return Boolean(contractor.stripe_account_id) && contractor.stripe_payouts_enabled;
```

It gates on `stripe_payouts_enabled`, and its doc comment addresses the brief's
instruction head-on:

> Gates on the `transfers` capability (stored as `stripe_payouts_enabled`), NOT
> on `stripe_charges_enabled`. These are destination charges: the platform is
> the merchant of record, so the connected account only ever needs `transfers`
> — which is the one capability `createConnectedAccount` requests.
> `stripe_charges_enabled` is derived from `card_payments`, which is
> deliberately never requested, so it is **false for every contractor and
> always will be**. Gating on it held the pay button shut for everyone
> regardless of onboarding state.

Verified: `createConnectedAccount` requests `capabilities: { transfers: { requested: true } }`
only (`stripe-connect.ts:46-58`), and `refreshAccountStatus` maps
`stripe_charges_enabled` from `account.capabilities?.card_payments === "active"`
(line 119). [PAY-2](https://app.notion.com/p/3ba1e4f908b481839c4dc0caf0a9deb5)
records the same conclusion.

**So gating on `charges_enabled` would hide bank details from 100% of
contractors — the exact failure the brief was trying to prevent, inverted.**
The brief's own hedge — *"or the equivalent capability flag actually consulted
at payment time"* — resolves this: the correct gate is `canAcceptStripePayment`.
It already satisfies the brief's intent (it is a capability check, not an
account-existence check: `stripe_payouts_enabled` is false for a contractor
mid-verification who has an account row). The spec below is written against it.
**No halt required** — the brief anticipated this substitution.

### Is there a manual reconciliation path? — YES, so the brief's "more severe defect" hypothesis is refuted

The brief asked me to raise a separate, higher-severity ticket if manually-paid
invoices strand in `Awaiting payment` forever. They do not.
`markInvoicePaid` (`src/app/jobs/[id]/mark-paid-actions.ts:26-88`) accepts
`paymentMethod: "cash" | "bank_transfer" | "other"`, enforces ownership through
RLS, resolves a backdatable `paidAt`, and routes through the same
`settlePaidJob` path the webhook uses. It is surfaced by
`src/app/jobs/[id]/mark-as-paid-button.tsx`. **No ticket needed.**

### Alignment with the existing PAY programme

[PAY-8](https://app.notion.com/p/3bd1e4f908b48157bcc4e1eb7e55d93d) (Roadmap,
`payments`, **Shipped**, issue #240) is the parent of this finding. It names
both bypass paths and recommends exactly the brief's resolved direction:

> Recommended: render them only when no rail is available for that invoice —
> i.e. above the ceiling, or where the contractor has no completed connected
> account.

PAY-8 shipped only its measurement half — `reportOffRailsInvoices`
(`src/lib/report-off-rails-invoices.ts`) and
`/api/cron/report-off-rails-invoices` — and explicitly left the decision open.
The brief now closes it. PAY-8's binding constraint carries forward: *"No
removal of the above-ceiling fallback until a replacement path exists — a £15k
invoice must remain payable."* The spec honours it (over-ceiling already routes
to `transfer_only`).

**Worth noting separately:** the PAY-8 instrument returns JSON from a
cron-authenticated route and nothing consumes it — no digest, no alert, no
gate. Per `AGENTS.md`, a computed check that must reach a human cannot
terminate in a response body. Out of scope here; flagged for PAY-8 follow-up.

---

## FINDING 7 — Contractor SoW review bounced to an external sign-in page

**Diagnosis: CONFIRMED, root cause isolated exactly. Two of the brief's four
hypotheses are refuted.**

### What link was tapped, and how was it constructed?

`src/app/jobs/[id]/page.tsx:313` (the "Finish and send this quote" next-step
card) and `:555-560` (the Scope card), both:

```tsx
<InlineLink href={`/api/jobs/${job.id}/sow-pdf`} external target="_blank">
  Download statement of work
</InlineLink>
```

**Hypothesis "is it an absolute `motko.app` URL rather than an in-app route?" —
REFUTED.** The href is relative. `InlineLink` with `external`
(`src/components/ui/inline-link.tsx:42-47`) renders a plain `<a>` rather than a
Next `<Link>`, and passes `target="_blank"` straight through.

### The Capacitor WKWebView hypothesis — CONFIRMED, and it is the cause

`target="_blank"` inside the Capacitor WKWebView is handed to the system
browser. Safari carries no Supabase `sb-*` session cookie, so the request
arrives unauthenticated. What happens next is the decisive part:

`src/lib/supabase/middleware.ts:6-19` defines `PUBLIC_API_ROUTES`. It contains
`/api/quotes/[id]/pdf` and `/api/contracts/[id]/pdf` — but **not**
`/api/jobs/[id]/sow-pdf` (correctly: that route is tenant-scoped). So the
unauthenticated request falls through to lines 84-88:

```ts
if (!user && !isPublicRoute) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
```

The contractor gets a full HTML **sign-in page**, in Safari — not even the
route's own 401 JSON. Exactly the observation, "despite an active session".

### Why only this link, out of five

Complete inventory of `target="_blank"` document links in the app:

| Link | Route | Public? | Ejects to a login wall? |
|---|---|---|---|
| `jobs/[id]/page.tsx:313`, `:557` | `/api/jobs/[id]/sow-pdf` | **No** — authenticated, tenant-scoped (`route.ts:34-49`) | **YES** |
| `jobs/[id]/page.tsx:730` | `/api/quotes/[id]/pdf` | Yes (middleware:10) | No |
| `c/[id]/page.tsx:139` | `/api/contracts/[id]/pdf` | Yes (middleware:11) | No |
| `q/[id]/page.tsx:163` | `/api/quotes/[id]/pdf` | Yes | No |

The SoW route is the **only authenticated one**, which is precisely why it is
the only one that breaks — and why this was never caught: every other PDF link
in the app works fine from Safari because none of them needs a session.

### AASA is not involved — REFUTED, and this is NOT the same ticket as 3b

AASA governs **inbound** links from other apps into Motko. It cannot pull an
**outbound** `target="_blank"` navigation back into the WKWebView. Adding
`/api/jobs/*/sow-pdf` to the AASA paths would change nothing here (and iOS does
not fire universal links for a navigation the app itself originates). Finding 7
and Finding 3b share a symptom — "ended up in Safari" — and nothing else.

### "Is there a single upstream bug behind both 3b and 7?" — No

The brief hypothesised a route constructing contractor-facing links with the
customer-facing absolute URL builder. The only contractor-facing absolute-URL
construction in the tree is `src/lib/notify-contractor.ts:36-37`
(`${NEXT_PUBLIC_APP_URL}/jobs/${jobId}`), used for the notification email and
the push payload. Push taps are handled in-webview via
`window.location.assign(url)` (`src/components/native-app-init.tsx:66-69`), so
it is same-origin and does not eject. It is implicated in neither finding.
**There is no shared upstream bug.**

---

# 2. Common-cause analysis

## Do 3b and 7 share a root cause?

**No.** They share one symptom and nothing else.

- **3b** is inbound: an external app (Monzo/Stripe) navigating *into* motko.app.
  Governed by AASA + the associated-domains entitlement — both verified correct.
  Nothing in this tree is broken.
- **7** is outbound: the app's own WKWebView handing a `target="_blank"` link
  *out* to the system browser, where the session cookie does not exist and
  middleware redirects to `/login`. Governed by link construction and route
  auth. Entirely under this repo's control.

Fixing either does not move the other. They must be separate tickets, and
**only Finding 7 gets one.**

## Are 1, 2 and 4 all instances of "data exists but the render/dispatch layer does not consult it"?

**Findings 1 and 2: yes, and it is the same failure with the same shape.**

- **1:** `jobs.sow_json` is populated, schema-validated, and already rendered in
  full by `SowPdf`. The customer-facing renderer does not consult it —
  `quoteRowToPdfPayload`'s select (`render-quote.ts:78`) does not even fetch the
  column. Data present; render layer blind.
- **2:** `customers.contact.sms_opt_out` is populated, written atomically by an
  RPC, honoured at two sites. Two other lifecycle sends do not consult it —
  they have no SMS path to gate. Data present; dispatch layer blind.

In both cases the derived signal is trustworthy, the storage is sound, and the
consuming layer was built without reference to it. In both cases the fix is to
make the consumer read what already exists, not to produce anything new.

**Finding 4: no — it is the mirror image.** Nothing failed to consult available
data. The opposite happened: content that should never have been in the
customer-facing payload was authored *into* it, and the renderer faithfully
rendered what it was given. `renderContractTemplate` consults its input
correctly; the input is wrong. Grouping it with 1 and 2 would misdescribe the
fix — 1 and 2 need a consumer taught to read a source, 4 needs a source
cleaned.

**A third, sharper pattern does connect 3a, 5 and 6** — *state that must change
behaviour is computed and then dropped*:

- **3a:** `payment_intent.processing` / `payment_intent.payment_failed` arrive,
  are `console.log`-ed, and are never persisted — so the pending page has
  nothing to resolve against (`webhook/route.ts:120-136`).
- **5:** `quotes.status` is the guard `updateQuoteLineItems` correctly asserts,
  and that `redraftJob` and `setQuotePricingMode` simply do not read.
- **6:** `reportOffRailsInvoices` computes the leakage figure PAY-8 was built to
  get, and returns it as JSON to a cron caller that does nothing with it.

This is the `AGENTS.md` rule — *"A signal that must change behaviour cannot
terminate in telemetry"* — recurring three times in one end-to-end run, in three
different subsystems. That is worth more than any individual fix here.

---

# 3. Specs

Specs follow for findings **1, 2, 3a, 4, 6, 7**. There is deliberately **no spec
for 3b** (diagnosis refuted; every checkable layer is correct — see §1) and
**no spec for 5** (NOT FACTORY WORK, as directed; the separable guard defect is
specced as its own bug card in §5).

---

## SPEC 1 — Carry the scope of works onto the customer-facing quote

### 1. Problem

`QuotePdfPayload` (`src/lib/pdf/quote-payload.ts:20-43`) carries six fields:
`reference`, `createdAt`, `lineItems`, `jobType`, `contractor`, `customer`.
There is no scope, timeline, inclusions/exclusions or assumptions field.
`quoteRowToPdfPayload` (`src/lib/pdf/render-quote.ts:38-68`) never selects
`sow_json` — its query (line 78) reads
`created_at, line_items_json, job:jobs(extracted_json, customer:customers(...), contractor:contractors(...))`.
`QuotePdf` (`src/lib/pdf/quote-pdf.tsx:100-278`) therefore renders header →
parties → `MetaRow` (lines 126-130: job type, reference, date) → line-item table
→ totals → footer, and nothing else.

In fixed-price mode `applyPricingMode` (`src/lib/pricing-mode.ts:57-76`, line 73)
collapses the quote to a single line whose description comes from
`deriveWorksDescription` (`src/lib/pricing-mode.ts:18-23`):
`` `${sentenceCased} works as described` ``. The customer receives one line
reading `"Rewire works as described"` where "described" points at a scope of
works they were never sent.

The scope exists and is already fully rendered — by `SowPdf`
(`src/lib/pdf/sow-pdf.tsx:103-302`), served from
`/api/jobs/[id]/sow-pdf`, which is authenticated and tenant-scoped by
deliberate design (`src/app/api/jobs/[id]/sow-pdf/route.ts:28-33`) and reaches
only the contractor.

### 2. Why it matters

A fixed-price quote whose entire scope is the phrase "works as described" is not
a quote — it is a number with a dangling reference. The customer cannot tell
what is included, what is excluded, how long it will take, or what has been
assumed, and has nothing to hold the contractor to. When a dispute arises the
contractor has no evidence of agreed scope either: `sow_json` was never put in
front of the customer, so it proves nothing.

It also strands the product's core asset. The voice intake exists to capture
scope precisely — `sowStateSchema` has eighteen fields of it — and the one
document the customer actually reads discards all of it. Every SoW question
asked on the call is unbilled work until this ships.

### 3. Fix

**Both (a) and (b), and (a) is the load-bearing half.**

**(a) — quote-level scope section on the quote PDF.** This is where scope
belongs, because scope is a property of the job, not of a priced line. Room
groupings, exclusions, access constraints and assumptions do not decompose onto
line items without either duplication or arbitrary attribution, and in
fixed-price mode there is only one line to attach them to.

1. Extend `QuotePdfPayload` (`quote-payload.ts:20-43`) with an optional
   `scope?: QuoteScope` field, where `QuoteScope` is a **narrowed projection of
   `SowState`** — not `SowState` itself. It carries exactly:
   `overviewNarrative`, `rooms` (name / dimensions / work items),
   `additionalItems`, `existingConditions`, `accessIssues`, `inclusions`,
   `exclusions`, `materialsMentioned`, `materialsSupply`, `assumptions`,
   `timeline`. Optional, so a payload without it renders exactly as today.
2. Add a `buildQuoteScope(sow: SowState): QuoteScope | null` mapper in
   `quote-payload.ts` (keeping the module isomorphic — no Supabase import). It
   returns `null` when the SoW yields no renderable content (see §6).
   `timeline` comes from `synthesizeTimeline(sow, crewSize)`
   (`src/lib/schemas/sow.ts:646-673`), passing the crew size the pricing
   actually used as `crewSizeOverride` — the parameter exists for exactly this
   and prevents the understated-crew bug its comment records.
3. Add `sow_json` to the select in `renderQuotePdf`
   (`render-quote.ts:78`) and map it in `quoteRowToPdfPayload` (`:38-68`).
4. Render a **"Scope of work"** section in `QuotePdf`, positioned **between
   `MetaRow` (line 168) and the line-item table header (line 170)** — the
   customer reads what the work is before what it costs. Reuse `SowPdf`'s
   section structure and `sharedStyles.sectionTitle` so the two documents match.
   Add `Timeline` to `metaItems` (`quote-pdf.tsx:126-130`) when present.
5. Set `payload.scope` on the guest path too: add the field to `GuestQuote`
   (`src/lib/guest/quote.ts:23-42`) from the in-memory completed SoW, and map it
   in `guestQuoteToPdfPayload` (`src/lib/guest/pdf.ts:9-16`).

**(b) — make the fixed-mode line description self-supporting.** Change
`deriveWorksDescription` (`pricing-mode.ts:18-23`) so it never emits a dangling
reference. With a scope section now present on the document, the line reads
`"Rewire works — see Scope of work"`; with no scope section it must not promise
one, so it reads `"Rewire works"`. This requires `deriveWorksDescription` to
take a second argument, `hasScopeSection: boolean`, threaded from
`applyPricingMode`'s knowledge of whether `buildQuoteScope(sow)` returns
non-null.

**(b) alone is insufficient and must not ship alone** — it would tidy the phrase
while leaving the customer with no scope at all.

### 4. Acceptance criteria

1. `QuotePdfPayload` has an optional `scope` field; a payload omitting it
   produces a PDF byte-identical to the current output for the same inputs.
2. `renderQuotePdf`'s Supabase select string contains `sow_json`.
3. Rendering a quote whose job has a populated `sow_json` with at least one room
   produces a PDF containing the text `Scope of work`, the name of every
   `sow.rooms[].name`, and every string in `sow.rooms[].work_items`.
4. That PDF contains a `Timeline` meta value exactly equal to
   `synthesizeTimeline(sow, crewSize)` for the same SoW — asserted by calling
   the function, not by hardcoding a string.
5. That PDF contains every string in `sow.inclusions`, `sow.exclusions`,
   `sow.additional_items`, and every
   `sow.assumptions_and_unknowns[].description`.
6. That PDF contains `sow.overview_narrative` when non-empty.
7. `deriveWorksDescription("rewire", true) === "Rewire works — see Scope of work"`.
8. `deriveWorksDescription("rewire", false) === "Rewire works"`.
9. `deriveWorksDescription("", false) === "Works"` and
   `deriveWorksDescription("", true) === "Works — see Scope of work"`.
10. No rendered quote PDF contains the substring `as described`.
11. A fixed-price quote on a job with a populated SoW renders **both** the single
    works line **and** the scope section.
12. An itemised (`days`/`calculated`) quote on the same job renders the scope
    section **and** the full line-item breakdown, with per-line
    `includes_tasks` sub-bullets unchanged.
13. A quote whose job has `sow_json = null` renders with no scope section, no
    `Timeline` meta cell, and no empty headings.
14. No customer-facing quote PDF contains any value from
    `quote.contractor_flags_json`, from any line item's `assumption_note`, or
    from `sow.next_question` / `sow.unasked_required` / `sow.wrap_incomplete`.
15. A guest quote with a completed in-memory SoW renders the scope section in
    the browser-rendered PDF.
16. **Golden re-baseline.** The four fixtures in
    `tests/regression/quote-pdf-golden.json` — `vat-registered-with-logo`,
    `non-vat-no-logo`, `footer-terms`, `unpriced-labour` — all carry
    `sow_json = null` in `tests/helpers/quote-pdf-fixtures.ts` and must hash
    **unchanged**, proving the no-scope path is untouched. A **fifth** fixture,
    `with-scope`, is added with a populated `sow_json`, and the golden is
    regenerated with
    `UPDATE_QUOTE_PDF_GOLDEN=1 npx vitest run tests/regression/quote-pdf-golden.test.ts`
    **in its own commit**, per the header comment at
    `tests/regression/quote-pdf-golden.test.ts:10-13`.
17. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` both
    pass.

### 5. Out of scope

- The SoW PDF (`src/lib/pdf/sow-pdf.tsx`) and its route — unchanged, and it
  stays contractor-only and authenticated.
- The contract PDF, the contract templates and `{{scope_of_work}}`.
- The voice intake, `sowStateSchema`, `mergeSowDelta`, the checklist questions
  and the wrap logic — this ticket reads `sow_json`, never writes it.
- Pricing: no change to any amount, to `computeQuoteTotals`, to
  `compileDraftToLineItems`, or to which lines `applyPricingMode` selects. Only
  the fixed works line's **description string** changes.
- The quote editor UI. The contractor does not gain a scope-editing surface here.
- The `/q/[id]` customer web page — this ticket changes the PDF only.
- Backfill: existing sent quotes are not re-rendered or re-sent.
- Finding 7's SoW link ejection — separate ticket.

### 6. Behaviour on edge cases

- **Scope is quote-level, never per-line.** Line items keep their own
  `description`, `includes_tasks` and `customer_note`. Nothing is duplicated
  between the scope section and the table.
- **Multi-line-item quotes:** one scope section, rendered once, above the table,
  regardless of line count.
- **Utterance too thin to derive scope.** `buildQuoteScope` returns `null` when
  `rooms`, `additional_items`, `inclusions`, `exclusions`,
  `assumptions_and_unknowns` and `materials_mentioned` are **all** empty **and**
  `overview_narrative`, `existing_conditions` and `access_issues` are all
  absent. The document then omits the section entirely — no heading, no "None
  captured" placeholder. `deriveWorksDescription` receives `hasScopeSection =
  false` and emits `"Rewire works"`.
- **Partially thin scope:** any single populated field is enough to render the
  section. Empty sub-sections within it are omitted individually, matching
  `SowPdf`'s existing rule (`sow-pdf.tsx:161,171,…` all guard on non-empty).
- **`timeline` unresolvable:** `synthesizeTimeline` already falls back to
  `"To be confirmed before work begins."` (`sow.ts:665`). Render that — it is a
  meaningful statement, and the SoW PDF already treats Timeline as the one cell
  that always resolves (`sow-pdf.tsx:118-120`).
- **Fixed-price mode:** scope section renders in full; the single works line
  carries the price. The section is what "described" now refers to.
- **Itemised mode:** identical scope section; the table is unchanged.
- **Legacy quotes with `pricing = null`:** `applyPricingMode` returns the
  calculated breakdown (`pricing-mode.ts:67-69`), unchanged. Scope renders if
  `sow_json` exists.
- **Guest mode:** scope renders; `contractor` stays `null` and the identity block
  stays omitted, per `quote-payload.ts:16-19`.
- **Guest with no captured SoW:** no scope section, exactly as a stored quote.
- **`sow_json` present but fails `sowStateSchema` parse:** treat as absent,
  render no scope section, and `logError`. A malformed SoW must never block a
  quote PDF that would otherwise render — the money document is the priority.
- **Contractor-only content must not leak.** `assumptions_and_unknowns[].description`
  is customer-facing (the SoW PDF already prints it under a
  "Confirm the following with the customer" intro, `sow-pdf.tsx:245-249`) and
  renders here. `contractor_flags`, `assumption_note`, `next_question`,
  `unasked_required` and `wrap_incomplete` are contractor-only and must not.
  Criterion 14 binds this.
- **A very long scope pushing the table to page 2:** acceptable. `@react-pdf`
  paginates; the fixed page-number footer (`quote-pdf.tsx:270-274`) already
  handles multi-page.

---

## SPEC 2 — Route every customer-facing lifecycle send through one dispatcher

### 1. Problem

There is no dispatcher. Each lifecycle send is written inline at its call site,
and only one of them does SMS.

- **Quote sent** — `src/app/jobs/actions.ts:973-1032`. Builds `sendEmail` and
  `sendSms` closures, each wrapped in `withTimeout`, runs them under
  `Promise.all` (line 1022), logs per-channel failures independently, and flips
  status via an idempotent `markSent`. ~60 lines, none of it reusable.
- **Contract sent** — `src/app/dashboard/actions.ts:179-190`. In full:
  `if (job.customer?.contact?.email) { const result = await sendContractEmail({…}); delivered = result.delivered; }`.
  **No SMS branch.** The customer's phone is present in the selected `contact`
  JSON (`:132`) and never read.
- **Invoice sent** (manual, and the automatic deposit invoice raised on
  signature) — `src/lib/invoicing.ts:83-93`. Same shape,
  `if (input.customerEmail) { … }`. **No SMS branch.**
- **Chase** — `src/app/api/cron/chase/route.ts:143-178`. Email + SMS, with its
  own per-channel claim/release dedup.
- **Contract-signed confirmation to the customer** and **payment receipt to the
  customer** — no send site exists at all.

`src/lib/sms.ts` exports only `sendQuoteSms` (:15) and `sendChaseSms` (:75).
No contract or invoice SMS function has ever been written.

### 2. Why it matters

This is the `AGENTS.md` anti-pattern, and it should be named as such in review:
**a signal that must change behaviour exists, is trusted, and is not consulted
at every site.** `customers.contact.sms_opt_out` is written by `sendQuote`
(`src/app/jobs/actions.ts:909`) and by the inbound Twilio STOP handler through
the `set_sms_opt_out` RPC (`src/app/api/twilio/inbound/route.ts:46`), and
honoured at two of the five customer-facing sends. The other two cannot honour
it because they have no SMS path — the signal is not ignored so much as
unreachable.

Customer-facing consequence: a customer who gave a phone number and no email
receives the quote by SMS, then silence. The contract that needs their signature
and the invoice that needs their money are sent to an address they do not have.
The job stalls and the contractor is left chasing something the product simply
did not send. `customerInputSchema` (`src/lib/schemas/customer.ts:11-25`)
explicitly permits phone-only customers, so this is a supported configuration
that the lifecycle silently fails.

Revenue: an invoice that reaches no channel is an invoice that does not get
paid, and under fee-at-source motko earns nothing on it either.

### 3. Fix

**A shared dispatcher. Recommended, and a per-site patch should be rejected.**

Justification, on the brief's own terms: a per-site patch is three copies of
timeout handling, opt-out checking, per-channel error logging and delivery
reporting, and it regresses the moment a sixth lifecycle step is added — the
"contract signed" and "payment receipt" sends do not exist *yet*, and under a
per-site regime they will each be written from scratch and each be free to
forget the opt-out. The quote path already proves the cost: it is the only site
with `withTimeout` and independent per-channel logging, and none of that
reached the other two.

Introduce `src/lib/notify-customer.ts`:

```ts
export type LifecycleEvent =
  | "quote_sent" | "contract_sent" | "invoice_sent"
  | "contract_signed" | "payment_received";

export const notifyCustomer = async (input: {
  event: LifecycleEvent;
  customer: { name: string; email?: string; phone?: string; smsOptOut: boolean };
  companyName: string;
  url: string;
  amount?: number;
  emailExtras?: { pdfAttachment?: { filename: string; content: Buffer } };
  channels?: { email: boolean; sms: boolean };
}): Promise<DeliveryReport>;
```

`DeliveryReport` is
`{ delivered: boolean; email: {attempted, delivered}; sms: {attempted, delivered} }`
— the shape `sendQuote` already returns (`src/app/jobs/actions.ts:1038-1043`),
so its callers and the `?delivered=0` banner convention in `CLAUDE.md` are
unaffected.

The dispatcher owns, once: channel eligibility (`email && Boolean(customer.email)`;
`sms && Boolean(normalizedPhone) && !customer.smsOptOut`), phone normalisation
via `src/lib/phone.ts`, `withTimeout` per channel at the existing `TIMEOUT_MS`
budgets, `Promise.all` so neither channel blocks the other, per-channel
`logError`, and the per-event copy table mapping `LifecycleEvent` to its email
and SMS body.

Then:

1. Add `sendContractSms` and `sendInvoiceSms` to `src/lib/sms.ts`, mirroring
   `sendQuoteSms`'s structure exactly — graceful degradation on missing Twilio
   credentials (return `{delivered:false}`, never throw) and a `Reply STOP to
   opt out.` suffix for PECR compliance.
2. Rewrite `sendQuote` (`src/app/jobs/actions.ts:940-1043`) to call
   `notifyCustomer`, keeping `markSent` at the call site (status transitions are
   the caller's business, not the dispatcher's).
3. Rewrite `createContract` (`src/app/dashboard/actions.ts:179-190`) to call
   `notifyCustomer` with `event: "contract_sent"` and the PDF attachment. It
   must now select and pass the customer's phone.
4. Rewrite `createInvoiceRecord` (`src/lib/invoicing.ts:83-93`) likewise.
   `CreateInvoiceRecordInput` gains `customerPhone?` and `customerSmsOptOut?`;
   both call sites — the dashboard action and `signContract`
   (`src/app/c/[id]/actions.ts:63-71`) — must pass them.
5. Leave the chase cron on its own path (see Out of scope).

### 4. Acceptance criteria

1. `src/lib/notify-customer.ts` exports `notifyCustomer`, and
   `src/app/jobs/actions.ts`, `src/app/dashboard/actions.ts` and
   `src/lib/invoicing.ts` each import it.
2. Neither `src/app/dashboard/actions.ts` nor `src/lib/invoicing.ts` contains a
   direct call to `sendContractEmail` / `sendInvoiceEmail`.
3. `src/lib/sms.ts` exports `sendContractSms` and `sendInvoiceSms`.
4. Sending a contract to a customer with **both** email and phone, `smsOptOut =
   false`, attempts **both** channels — asserted on the mocked senders, one call
   each.
5. Sending a contract to a customer with **phone only** attempts SMS, does not
   attempt email, and returns `delivered: true` when SMS succeeds.
6. Sending an invoice to a customer with **phone only** attempts SMS, does not
   attempt email, and returns `delivered: true` when SMS succeeds.
7. With `contact.sms_opt_out = true`, contract send and invoice send both
   attempt email only, and `report.sms.attempted === false`.
8. When the email sender rejects and the SMS sender resolves `{delivered:true}`,
   `notifyCustomer` resolves `{delivered: true, email:{delivered:false},
   sms:{delivered:true}}` and does not throw.
9. When both channels fail, `notifyCustomer` resolves `delivered: false` and
   does not throw.
10. When both channels fail on a contract send, the contract row is still
    written with `status: "sent"` (`src/app/dashboard/actions.ts:165`) —
    unchanged behaviour, per `CLAUDE.md`'s spent-form rule.
11. A channel that exceeds its `TIMEOUT_MS` budget resolves as
    `{delivered:false}` and does not delay the other channel's result.
12. Every SMS body emitted by `sendContractSms` and `sendInvoiceSms` ends with
    `Reply STOP to opt out.`
13. The deposit invoice raised automatically by `signContract` fans out on both
    channels for a customer with both contact details.
14. `sendQuote`'s return shape is unchanged: `{delivered, email:{attempted,
    delivered}, sms:{attempted, delivered}, quoteUrl}`.
15. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` pass.

### 5. Out of scope

- **The chase cron** (`src/app/api/cron/chase/route.ts`). Its per-channel
  claim/release dedup against `chase_events` is a different concern from
  one-shot lifecycle delivery, and folding it in would drag transactional
  claiming into the dispatcher. It already honours `sms_opt_out` (`:145`).
  Migrate it separately if ever.
- **Contractor notifications** (`src/lib/notify-contractor.ts`) — different
  recipient, different channels (email + push), out of scope.
- **New lifecycle events.** `LifecycleEvent` declares `contract_signed` and
  `payment_received` so the type is complete, but **no send site for either is
  built here.** Adding those sends is a separate product decision.
- No change to `sendQuoteSms`/`sendQuoteEmail` copy, or to any existing email
  body or subject.
- No stored positive channel-preference field on the customer. The existing
  negative `sms_opt_out` flag plus per-send `channels` is the model; changing it
  is a data-model decision.
- No change to `customerInputSchema` or to the at-least-one-contact refine.
- No retry, queue or dead-letter mechanism. Best-effort, as today.
- No backfill or re-send of anything already sent.

### 6. Behaviour on edge cases

- **Email only:** SMS not attempted, `sms.attempted === false`. Not an error.
- **Phone only:** email not attempted. Not an error.
- **Neither (today's behaviour, preserved):** `customerInputSchema`'s refine
  (`src/lib/schemas/customer.ts:22-25`) blocks this at quote send. Contract and
  invoice sends inherit the customer row created there, so a
  neither-channel customer cannot reach them. If one somehow does,
  `notifyCustomer` attempts nothing and resolves `delivered: false`; the record
  still flips to sent and the caller falls back to the copy-link banner, per
  `CLAUDE.md`. No throw.
- **SMS fails, email succeeds:** `delivered: true`. Independent channels, per
  the existing comment at `src/app/jobs/actions.ts:948-951`.
- **Both fail:** `delivered: false`; record still marked sent; caller navigates
  to `/jobs/[id]?sent=…&delivered=0`. No exception propagates to the UI.
- **Twilio credentials absent:** `sendContractSms`/`sendInvoiceSms` return
  `{delivered:false}` without throwing, mirroring
  `src/lib/sms.ts:22-25`. Treated as a delivery failure, not a crash.
- **Resend credentials absent:** same, mirroring `src/lib/email.ts`.
- **Customer changes preference mid-job — already-sent steps do NOT resend.**
  `notifyCustomer` is called at the moment of a lifecycle transition and nowhere
  else. A customer who texts STOP after the quote went out will not receive the
  contract by SMS, and nothing already delivered is re-delivered on any channel.
  There is no reconciliation sweep, and this ticket does not add one.
- **STOP arrives between eligibility check and Twilio dispatch:** the message
  may still go out. Accepted — the window is milliseconds, Twilio enforces STOP
  at the carrier level independently, and closing it would need a
  read-modify-write per send.
- **Phone number fails E.164 normalisation:** treat as no phone. SMS not
  attempted; `sms.attempted === false`; `logError` once.
- **Contract PDF attachment fails to render:** unchanged — `renderContractPdf`
  is already `.catch(() => null)` (`src/app/dashboard/actions.ts:176`) and the
  email sends without it. SMS is unaffected; it carries a URL only.
- **Duplicate invoice (idempotency hit):** `createInvoiceRecord` returns early
  on an existing matching invoice (`src/lib/invoicing.ts:57-64`) **before** any
  send. `notifyCustomer` is not called. Unchanged.
- **Deposit invoice on a double-signature race:** `signContract` bails before
  `createInvoiceRecord` when the UPDATE matches no row
  (`src/app/c/[id]/actions.ts:57`). Unchanged.

---

## SPEC 3a — Resolve the payment pending page

### 1. Problem

`src/app/i/[id]/paid/page.tsx:33-118` is an `async` server component with no
client component, no polling, no `revalidate` and no redirect. It computes once,
at request time:

```ts
const settled = invoice?.status === "paid" || invoice?.paid_at != null;  // :62
```

and on `false` renders a static "Payment pending — We haven't had confirmation
from your bank yet." block (`:98-113`). Nothing on the page can change that
state. Only a manual reload can, and nothing asks the customer to reload.

The page is reached correctly: Stripe's `return_url` is
`${window.location.origin}/i/${invoiceId}/paid`
(`src/app/i/[id]/pay-button.tsx:56`), and the redirect fires as soon as the
customer returns from their bank — before `payment_intent.succeeded` has
settled anything (`src/app/api/stripe/webhook/route.ts:89-116` →
`settlePaidJob`). Gating the receipt on the invoice's own record is right and
must not change.

**The compounding defect:** the intermediate outcomes are never persisted.
`payment_intent.processing` (`webhook/route.ts:120-127`) and
`payment_intent.payment_failed` (`:129-136`) each `console.log` and return
`{received: true}`, writing nothing. So no stored state distinguishes
*processing* from *failed* from *abandoned*, and a polling page would have
nothing to poll for beyond `status === "paid"`.

### 2. Why it matters

This is the last screen in the money flow, and it is the one screen a customer
looks at to find out whether their money moved. Telling them "pending" forever
is worse than telling them nothing: a customer who paid does not know it landed,
and a customer whose payment failed is actively reassured that "there's nothing
else you need to do right now" while the invoice sits unpaid. Pay by Bank
settles in seconds to minutes, so the overwhelmingly common case is a customer
who has genuinely paid staring at a page that will confirm it if they reload and
never tells them to.

Revenue: a customer who believes they have paid does not retry, and the
contractor chases an invoice that is either already settled or silently failed.
Under fee-at-source a failed payment that is never retried is a fee motko never
earns.

`AGENTS.md`: *"A signal that must change behaviour cannot terminate in
telemetry."* A failed payment must change what the customer is told, and today
it terminates in `console.log`.

### 3. Fix

**Two parts. Part B is a precondition for part A being honest.**

**(B) Persist the intermediate outcomes.** In
`src/app/api/stripe/webhook/route.ts`, make `payment_intent.processing` and
`payment_intent.payment_failed` write to the invoice row:

- `processing` → set `payment_status = 'processing'` (a **new** nullable column;
  do **not** touch `invoices.status`, which drives the job pipeline).
- `payment_failed` → set `payment_status = 'failed'` and store
  `last_payment_error` (message and code only, never the full Stripe object).

Both must be no-ops on an invoice already `status = 'paid'`, so a late
`processing` cannot regress a settled invoice.

**Migration ordering** — per `CLAUDE.md`, schema must precede code: the
migration adding `invoices.payment_status` and `invoices.last_payment_error`
is applied to production with `supabase db push` **before** this PR merges, and
`supabase migration list` is verified in sync before the session closes.

**(A) Make the page resolve.** Convert the pending branch (and only that branch)
into a client component that polls a new public status endpoint,
`GET /api/invoices/[id]/payment-status`, returning
`{ state: "paid" | "processing" | "failed" | "unknown", amount, paidAt }` and
nothing else — no PII, no bank details, no contractor identity.

- Poll every **3 seconds** for the first 30s, then every **10 seconds** to a
  **3-minute** total ceiling.
- On `paid` → stop polling and render the "Payment received" state in place, on
  the same page, without a navigation.
- On `failed` → stop polling and render a failure state naming the invoice as
  still open, with a link back to `/i/[id]`.
- On timeout at 3 minutes → stop polling and render a terminal-but-honest state
  (see §6).

The settled branch (`:81-97`) is untouched and stays a server render — a
customer arriving at an already-paid invoice must not pay for a client bundle.

The endpoint must be added to `PUBLIC_API_ROUTES`
(`src/lib/supabase/middleware.ts:6-19`) — and, per `AGENTS.md`, that is a
registration through the intended path, which surfaces as a `DECISION NEEDED`-
equivalent notice in the triage digest so a human sees the new unauthenticated
surface. It must also be registered in the public-API-route list in
`tests/acceptance/99.test.ts` **through that registry's intended registration
path** — never by moving the route out of the registry's view.

### 4. Acceptance criteria

1. A migration adds nullable `invoices.payment_status` and
   `invoices.last_payment_error`; `invoices.status` is unchanged in shape and
   meaning.
2. Handling `payment_intent.processing` for an unpaid invoice sets
   `payment_status = 'processing'` and leaves `status` and `paid_at` untouched.
3. Handling `payment_intent.payment_failed` sets `payment_status = 'failed'`
   and persists the error message and code, and leaves `status` untouched.
4. Handling either event for an invoice already `status = 'paid'` writes
   nothing.
5. `payment_intent.succeeded` behaviour is unchanged: `settlePaidJob` is called
   with the same arguments, including
   `feeCollectedAtSource: (application_fee_amount ?? 0) > 0`.
6. `GET /api/invoices/[id]/payment-status` returns exactly
   `{state, amount, paidAt}`; its response body contains no sort code, no
   account number, no customer name and no contractor name — asserted on the
   serialised body.
7. It returns `state: "paid"` when `status === 'paid' || paid_at != null`,
   matching `paid/page.tsx:62` exactly.
8. It returns 404 for an unknown invoice id, with no distinguishing body.
9. The endpoint appears in `PUBLIC_API_ROUTES` in
   `src/lib/supabase/middleware.ts` and in the public-API-route registry in
   `tests/acceptance/99.test.ts`, added via that registry's registration path.
10. On the pending page, a status response of `paid` renders "Payment received"
    with the amount, **without a page navigation**, and stops further polling —
    asserted by counting fetches after resolution.
11. A status response of `failed` renders a failure state containing a link to
    `/i/[id]`, and stops polling.
12. Polling stops permanently at 3 minutes and issues no further requests.
13. An already-paid invoice renders the receipt server-side with **no** polling
    client mounted — zero requests to the status endpoint.
14. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` pass.

### 5. Out of scope

- `settlePaidJob` and every downstream settlement effect — fee accrual, referral
  credits, free-job decrement.
- `invoices.status` and the job pipeline states it drives.
- The `/i/[id]` pay page, `buildPayPanel`, and the bank-transfer panel (Finding
  6's ticket owns those).
- `PayButton` and the `confirmPayment` call, including its `return_url`.
- Push or email notification of payment outcome to the customer or contractor.
  `notifyContractorOfCustomerAction` already fires on settlement and is
  unchanged.
- The chase cron and its overdue logic.
- PAY-7's contractor-side fee collection — unrelated.
- Any change to what the contractor sees (see §6).
- Capability tokens on the invoice or receipt route — the existing Backlog card
  owns that.

### 6. Behaviour on edge cases

- **Genuinely pending for minutes (Pay by Bank can be slow).** Polling covers 3
  minutes. Beyond that the page stops polling and states plainly that
  confirmation has not arrived yet, that the payment may still complete, that
  the customer should **not** pay again, and that they can reopen the link
  later. It must **not** claim failure — an unconfirmed payment is not a failed
  one.
- **Failed:** `payment_status = 'failed'` → explicit failure state, invoice
  named as still open, link to `/i/[id]` to retry. Never "nothing else you need
  to do".
- **Abandoned** (customer never authorised; no webhook ever arrives):
  indistinguishable from slow at the data layer. Falls to the 3-minute timeout
  state above, which is worded to cover both.
- **Failure arrives after the 3-minute timeout:** the customer sees the timeout
  state, not a failure state, until they reload. Accepted — the timeout copy
  already tells them the invoice may still be open and links to it.
- **Customer closes the tab and returns via the original link:** `/i/[id]`
  redirects to `/i/[id]/paid` when `status === 'paid'`
  (`src/app/i/[id]/page.tsx:66`) — unchanged. If unpaid, they get the pay page
  and can retry. If `payment_status = 'processing'`, they still get the pay
  page: the invoice genuinely is unpaid, and blocking a retry on an unconfirmed
  intermediate state risks stranding them.
- **Customer pays twice** (retries during a slow settle): out of scope here.
  `settlePaidJob` is idempotent on the invoice, and duplicate-charge handling is
  a Stripe-side concern this ticket does not touch.
- **What the contractor sees during the pending window: unchanged.** The job
  page and dashboard read `invoices.status`, which stays `sent` until
  settlement. `payment_status` is deliberately **not** surfaced to the
  contractor in this ticket — telling a contractor "processing" invites them to
  act on an unsettled payment, and deciding whether they should see it is a
  product call, not part of fixing a dead-end page. Flagged for Jacob; not
  actioned.
- **Marked paid off-rails while a customer sits on the pending page:**
  `markInvoicePaid` → `settlePaidJob` sets `status = 'paid'`, the next poll
  returns `paid`, and the page resolves to the receipt. Correct — the invoice
  genuinely is paid.
- **Webhook signature verification failure:** unchanged; the event is rejected
  and nothing is written.
- **Late/out-of-order webhooks:** `processing` arriving after `succeeded` is a
  no-op by criterion 4.

---

## SPEC 4 — Stop internal template annotations rendering in customer contracts

### 1. Problem

`"Use for:"` is **not** a metadata field. It is literal markdown inside each
template's `body` string. `ContractTemplateDefinition`
(`src/lib/contracts/templates.ts:523-528`) is
`{key, label, description, body}`, and `renderContractTemplate`
(`src/lib/contracts/render-template.ts:9-13`) receives `body` alone —
never the object — and performs only `{{#section}}` / `{{var}}` substitution.
No object is passed through; nothing can leak that way.

All five bodies open with the same three-line authoring preamble, at
`templates.ts` **10-11**, **98-99**, **210-211**, **327-328** and **431-432**:

```
**Use for:** single-visit or low-value jobs, paid on completion (…).
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use.*
```

`parseContractMarkdown` (`src/lib/contracts/markdown.ts:49+`) parses these as an
ordinary bold paragraph and an italic paragraph, and both `ContractPdf` and the
public `/c/[id]` page render them to the customer.

`templates.ts:3-6` additionally carries a file-level comment repeating the stale
claim: *"Draft templates — a solicitor should review before use"*, alongside a
standing instruction *"Do not edit the wording"*.

### 2. Why it matters

A customer being asked to sign is shown, inside the agreement itself, an
instruction that the document is an unreviewed draft that a solicitor should
check. It reads as the contractor disclaiming their own contract. It invites the
customer to refuse to sign, or to sign and later argue the terms were presented
as provisional. It is also now **false** — the wording has been through legal
review — so it misrepresents the document to the one person whose agreement it
is meant to record. `"Use for:"` is worse in kind if not in effect: it is
selection guidance addressed to the tradesperson, sitting in the customer's copy.

Internally, any contractor or agent reading `templates.ts` today concludes the
templates have not been reviewed. Fixing only the render leaves that
misinformation in place, which is why the stored value changes in the same
ticket.

### 3. Fix

**Three changes, one ticket.**

**(a) Delete the `**Use for:**` line from all five bodies** — `templates.ts:10,
98, 210, 327, 431`. It is a duplicate: `description`
(`templates.ts:530-560`) carries the same guidance and already renders in the
contractor's template picker (`src/app/dashboard/create-contract-form.tsx:293`)
and nowhere customer-facing. **Do not** add a new field; the authoring field
already exists.

Where a `**Use for:**` line carries guidance `description` does not — the
regulated/certified template's *"Can be used standalone or its compliance
clauses (2, 3, 4) bolted onto the Standard or Large-Project templates"*
(`:327`) — move that sentence into that template's `description` so no authoring
information is lost.

**(b) Rewrite the italic line in all five bodies** — `templates.ts:11, 99, 211,
328, 432` — keeping the jurisdiction statement and dropping the stale
draft/solicitor annotation:

```
*Jurisdiction: England & Wales.*
```

Jurisdiction is legitimate contract content and must stay. Two templates carry
extra clauses on that line that are **also** internal review guidance and go
with it: *"especially the payment-schedule and retention clauses"* (`:211`),
*"especially the auto-renewal and cancellation terms"* (`:432`).

One is different and must **not** be silently dropped: `:328` carries *"Do not
use this to imply a registration the tradesperson does not actually hold."* That
is an instruction **to the contractor**, not customer-facing prose, and it is a
compliance guard. Move it into that template's `description`.

**(c) Update the file-level comment** at `templates.ts:3-6` so it no longer
states the templates are unreviewed drafts, and so it explicitly authorises this
edit. Without this, the standing *"Do not edit the wording"* instruction will
make the next agent refuse the ticket.

### 4. Acceptance criteria

1. No string in `CONTRACT_TEMPLATES[].body` contains `Use for:`.
2. No string in `CONTRACT_TEMPLATES[].body` contains `solicitor`.
3. No string in `CONTRACT_TEMPLATES[].body` contains `Draft template`.
4. Every `CONTRACT_TEMPLATES[].body` still contains
   `Jurisdiction: England & Wales`.
5. The `regulated_certified_works` template's `description` contains the
   registration-implication warning.
6. Every `CONTRACT_TEMPLATES[]` entry has a non-empty `description`, and all
   five are distinct.
7. For each of the five templates, `renderContractTemplate(body, variables)`
   with a fully-populated `ContractVariables` produces output containing none of
   `Use for:`, `solicitor`, `Draft template`.
8. `parseContractMarkdown(renderContractTemplate(body, vars))` yields, as its
   first blocks, the `h1` heading followed by the jurisdiction paragraph and the
   `hr` — with no bold `Use for:` paragraph between them.
9. Each template still renders its `# Contract for …` / `# Maintenance …`
   heading, and every `{{variable}}` and `{{#section}}` still substitutes
   correctly — no template literal is left with an unbalanced section tag.
10. `src/lib/contracts/templates.ts:3-6` no longer states the templates are
    unreviewed drafts.
11. **Golden re-baseline — read this criterion carefully.** There is **no
    contract-PDF golden** in this repo. `tests/regression/` contains
    `quote-pdf-golden.test.ts` / `quote-pdf-golden.json` only, covering the
    **quote** PDF fixtures `vat-registered-with-logo`, `non-vat-no-logo`,
    `footer-terms`, `unpriced-labour`. This ticket does not touch the quote
    document, so **all four quote goldens must hash unchanged and must NOT be
    regenerated** — a diff there means the change leaked out of scope and is a
    failure, not a re-baseline. Because the contract PDF has no golden, this
    ticket **adds one**: `tests/regression/contract-pdf-golden.test.ts` +
    `contract-pdf-golden.json`, one fixture per template key (five), mirroring
    the quote gate's structure — stubbed admin client, `normalizePdfBytes`,
    sha256, and an `UPDATE_CONTRACT_PDF_GOLDEN=1` regeneration escape hatch
    documented in the file header. The baseline is committed from the
    **post-fix** output, in its own commit.
12. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` pass.

### 5. Out of scope

- **Every clause of every contract body except the preamble lines named in §3.**
  The legal wording is not touched.
- `renderContractTemplate` (`src/lib/contracts/render-template.ts`) — it is
  correct and needs no change.
- `parseContractMarkdown` (`src/lib/contracts/markdown.ts`) — no new syntax, no
  comment or metadata-stripping mechanism.
- `buildContractVariables` and `ContractVariables`.
- `ContractTemplateDefinition`'s shape — no new field is added.
- `ContractPdf` (`src/lib/pdf/contract-pdf.tsx`) and the `/c/[id]` page layout.
- The contract creation form, other than the `description` strings it displays.
- **Backfill of existing contracts** (see §6).
- The quote PDF, the SoW PDF, and their goldens.
- Contract immutability and versioning — Finding 5's decision, untouched.

### 6. Behaviour on edge cases

- **Contracts already created keep the annotation, and are NOT backfilled.**
  `rendered_body` is frozen at creation (`src/app/dashboard/actions.ts:167`) and
  both readers use the stored string (`src/app/c/[id]/page.tsx:53`,
  `src/lib/pdf/render-contract.ts:47`). Rewriting `rendered_body` on an
  already-**signed** contract would alter the text a customer signed — a worse
  defect than the one being fixed, and it would pre-empt Finding 5's open
  decision. Sent-but-unsigned contracts are left alone too, for consistency and
  because the set is small. **If Jacob wants existing contracts corrected, that
  is a separate ticket with its own decision about signed rows.**
- **A contract created from a cached module before deploy:** templates are
  compiled into the bundle, so the change takes effect on deploy with no
  migration and no cache to clear.
- **`description` now the sole carrier of selection guidance:** it already
  renders at `create-contract-form.tsx:293`, so no UI change is needed. Criterion
  6 guards against an empty one.
- **A template body left with a leading blank line or a doubled `---` after
  deletion:** `parseContractMarkdown` skips empty lines
  (`markdown.ts:58-61`), so rendering is unaffected; still, delete the lines
  cleanly rather than blanking them, and criterion 8 asserts the resulting block
  sequence.
- **Jurisdiction must survive** (criterion 4). Removing it would strip a real
  contractual term while fixing an annotation.
- **A future template added without a `description`:** criterion 6 fails the
  suite, which is the intended guard.

---

## SPEC 6 — Show bank-transfer details only when the Stripe rail cannot take the payment

### 1. Problem

`buildPayPanel` (`src/app/i/[id]/pay-panel.ts:45-73`) returns
`button_with_transfer` whenever `input.railsAvailable && !exceedsLimit`
(line 67), carrying the full `TransferDetails`. `src/app/i/[id]/page.tsx:149-161`
then renders, inside one card: `<PayButton>` (accessible name
`"Pay £8,132.00 by bank"`, `pay-button.tsx:80-87`), the reassurance strip, and a
`<details><summary>` reading **"Or pay by bank transfer"** (line 155) that
reveals `<BankTransferDetails>` — account holder, sort code, account number,
amount and reference, three of them with Copy buttons
(`src/app/i/[id]/bank-transfer-details.tsx:70-96`).

The details are behind a disclosure, but the `<details>` element ships them in
the served HTML whether or not the customer expands it.

The gate is `canAcceptStripePayment(contractor)` (`src/app/i/[id]/page.tsx:79`),
defined at `src/lib/stripe-connect.ts:150-170` as
`Boolean(stripe_account_id) && stripe_payouts_enabled`.

**A second, previously unlisted surface:** `src/lib/contracts/build-variables.ts:104-113`
composes `bankDetails` from `payout_account_holder_name` + `payout_sort_code` +
`payout_account_number` and exposes it as `{{bank_details}}`, which **all five**
contract templates render (`templates.ts:35, 135, 250, 374, 464`). It is gated on
`payout_details_complete` only — **never on rail availability**.

### 2. Why it matters

Under PAY-4 fee-at-source, motko earns only when money moves through the Stripe
rail — the fee rides `application_fee_amount` on the destination charge. A sort
code and account number rendered one tap from the pay button is a documented
bypass: the customer transfers direct, the contractor receives the full amount,
motko receives nothing, and PAY-5 removed the VRP path that used to catch it
after the fact. [PAY-8](https://app.notion.com/p/3bd1e4f908b48157bcc4e1eb7e55d93d)
names this as one of two structural leaks and recommends exactly this fix.

The leak is biased toward the largest invoices: a large amount is precisely what
makes a customer prefer a transfer they control, so the jobs that would carry the
biggest fee are the most likely to bypass it.

The contract surface is worse, because it is not even a disclosure — the bank
details are printed in the body of the signed agreement, reaching the customer
before the invoice exists.

Customer-facing risk if done carelessly: hiding the details from a contractor
who has **no working rail** leaves their customer with no way to pay at all. That
is why the gate must be a capability check, and why §6 defines a fallback for a
rail that is available but fails at payment time.

### 3. Fix

**Gate on `canAcceptStripePayment`, not on `charges_enabled`, and not on account
existence.**

The brief specified `charges_enabled`. **That flag is unusable here, and the
codebase records why** (`src/lib/stripe-connect.ts:155-161`):
`createConnectedAccount` requests only the `transfers` capability
(`stripe-connect.ts:46-58`); `stripe_charges_enabled` is mapped from
`account.capabilities?.card_payments` (`:119`), which is never requested, so it
is **false for every contractor and always will be**. Gating on it would hide
bank details from 100% of contractors — the exact failure the brief set out to
avoid. `canAcceptStripePayment` is the brief's "equivalent capability flag
actually consulted at payment time": it is a capability check
(`stripe_payouts_enabled` is false for a contractor mid-verification who already
has an account row), not an existence check.

**(a) Invoice page.** In `buildPayPanel` (`pay-panel.ts:45-73`), rename the
`button_with_transfer` mode to `button_only` and **stop constructing
`TransferDetails` on that branch at all** — the details must be absent from the
returned object, not merely unrendered, so they never reach the response body.
`transfer_only` is unchanged and keeps full details: it already covers both
no-rail and over-ceiling.

In `src/app/i/[id]/page.tsx:149-161`, delete the `<details>` disclosure and the
`<BankTransferDetails>` render from that branch. The `<ReassuranceStrip>` stays.

**(b) Contract templates.** In `build-variables.ts:104-113`, gate `bankDetails`
on rail availability as well as `payout_details_complete`: emit the details only
when the contractor **cannot** take a Stripe charge. This needs
`stripe_account_id` and `stripe_payouts_enabled` added to the contractor select
in `createContract` (`src/app/dashboard/actions.ts:132`) and to
`build-variables.ts`'s contractor type (`:29-31`). When the rail is available,
`bank_details` resolves to `""` and the `{{#bank_details}}` sections collapse to
nothing — the existing Mustache section mechanism
(`render-template.ts:10-12`) already handles this, so no template body changes.

**(c) Fallback when an available rail fails at payment time.** Add a
customer-triggered reveal on the invoice page: when `PayButton` sets an error
(`pay-button.tsx:60-63, 99`), including the existing `AMOUNT_TOO_HIGH` branch
(`:33-37`), render a "Pay by bank transfer instead" control that fetches the
transfer details from a new endpoint,
`GET /api/invoices/[id]/transfer-details`, and renders `<BankTransferDetails>`.
Fetched on demand so the details are never in the initial payload.

The endpoint must be added to `PUBLIC_API_ROUTES`
(`src/lib/supabase/middleware.ts:6-19`) and registered in the public-API-route
list in `tests/acceptance/99.test.ts` **through that registry's intended
registration path**. Per `AGENTS.md` this is registration, not repair, and it
surfaces as a `DECISION NEEDED`-equivalent notice in the triage digest — which
is correct and intended: this endpoint serves a sort code and account number on
an unauthenticated capability URL, and a human should see that.

**No copy ticket.** With `button_only` and `transfer_only` mutually exclusive,
"Pay by bank" and "Pay by bank transfer" are never co-present, so there is
nothing to disambiguate — as the brief directs.

### 4. Acceptance criteria

1. `buildPayPanel` returns `{mode: "button_only"}` with **no** `transfer`
   property when `railsAvailable === true` and the amount is at or below the
   £10,000 ceiling.
2. `buildPayPanel` returns `mode: "transfer_only"` with full `transfer` details
   when `railsAvailable === false` and payout details are complete.
3. `buildPayPanel` returns `mode: "transfer_only"` with full details when
   `railsAvailable === true` and the amount **exceeds** the ceiling — PAY-8's
   "a £15k invoice must remain payable" constraint holds.
4. `buildPayPanel` returns `mode: "setup_incomplete"` when payout details are
   incomplete, unchanged.
5. The rendered `/i/[id]` HTML for a `button_only` invoice contains **neither**
   the contractor's `payout_sort_code` **nor** `payout_account_number` anywhere
   in the response body — asserted on the serialised markup, not on visibility.
6. The rendered `/i/[id]` HTML for a `button_only` invoice contains no element
   with the text `Or pay by bank transfer`.
7. `/i/[id]` for a `transfer_only` invoice renders account name, sort code,
   account number, amount and reference, unchanged.
8. `buildContractVariables` returns `bank_details === ""` for a contractor with
   `stripe_account_id` set **and** `stripe_payouts_enabled === true`.
9. `buildContractVariables` returns populated `bank_details` for a contractor
   with `payout_details_complete === true` and `stripe_payouts_enabled ===
   false`.
10. `buildContractVariables` returns populated `bank_details` for a contractor
    with a `stripe_account_id` but `stripe_payouts_enabled === false` — the
    mid-verification case. Gating on account existence must fail this test.
11. Rendering each of the five templates with `bank_details: ""` produces output
    containing neither `Payment details:` nor `Details:` followed by an empty
    value — the `{{#bank_details}}` sections collapse cleanly.
12. `GET /api/invoices/[id]/transfer-details` returns the transfer details for
    an unpaid invoice, 404 for an unknown id, and 404 for an invoice already
    `status = 'paid'`.
13. The endpoint appears in `PUBLIC_API_ROUTES` and in the
    `tests/acceptance/99.test.ts` registry, added via the registry's
    registration path.
14. After `PayButton` sets an error, a control offering bank transfer appears;
    activating it fetches the endpoint and renders the details. Before the
    error, no fetch is made and no details are present.
15. The `AMOUNT_TOO_HIGH` (422) branch reaches the same fallback control.
16. **Golden re-baseline.** This ticket changes contract PDF output whenever
    `bank_details` collapses to empty. The four **quote** goldens in
    `tests/regression/quote-pdf-golden.json` — `vat-registered-with-logo`,
    `non-vat-no-logo`, `footer-terms`, `unpriced-labour` — are untouched by this
    change and **must hash unchanged**; a diff there is a failure, not a
    re-baseline. If SPEC 4's `contract-pdf-golden.json` has landed, its five
    per-template fixtures are re-baselined here with
    `UPDATE_CONTRACT_PDF_GOLDEN=1 …` **in its own commit**, and the fixture set
    is extended with one rail-available case (expecting no bank details) and one
    rail-unavailable case (expecting them). If SPEC 4 has not landed, this
    ticket creates that golden per SPEC 4 criterion 11.
17. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` pass.

### 5. Out of scope

- The £10,000 ceiling itself (`PAY_BY_BANK_LIMIT_PENNIES`,
  `pay-panel.ts:18`). PAY-8 holds that decision open.
- Fee amounts, banding, the free-job allowance, and `application_fee_amount`.
- `canAcceptStripePayment` itself — this ticket **consumes** it and does not
  change its definition, its `charges_enabled` reasoning, or the capabilities
  requested by `createConnectedAccount`.
- `markInvoicePaid` and the manual reconciliation path — verified working
  (`src/app/jobs/[id]/mark-paid-actions.ts:26-88`); no ticket needed.
- Capability tokens on `/i/[id]` — the existing Backlog card owns that. See the
  DECISION NEEDED in §4 about that card's now-stale Out of scope line.
- `reportOffRailsInvoices` and its delivery gap — PAY-8 follow-up.
- The reassurance strip's approved copy, which stays on the rail-available
  branch only, per the comment at `src/app/i/[id]/page.tsx:164-167`.
- Contractor-facing comms about losing the transfer option (see §6).
- The `/i/[id]/paid` receipt page — SPEC 3a owns it.

### 6. Behaviour on edge cases

- **Stripe enabled but no bank details configured:** `payoutReady` is false
  (`pay-panel.ts:49-54`) → `setup_incomplete`. Unchanged, and correct: both
  paths settle into the same account.
- **Both configured:** `button_only`. Bank details absent from the page and from
  the contract.
- **`charges_enabled` loses to `payouts_enabled`:** covered by criterion 10 —
  a contractor mid-verification has `stripe_account_id` but
  `stripe_payouts_enabled === false`, so they get `transfer_only` and their
  customer can still pay. Gating on account existence would strand them; that
  is the failure mode this criterion exists to prevent.
- **Contractor loses `charges_enabled`/`payouts_enabled` after an invoice was
  sent, and the customer opens the old link:** the panel is computed per request
  from live contractor state (`src/app/i/[id]/page.tsx:79-91`), so the customer
  gets `transfer_only` with full details. Correct — the rail genuinely cannot
  take the payment. The already-sent contract keeps whatever `bank_details` was
  frozen into its `rendered_body`; it is not re-rendered.
- **Rail available but the payment intent errors, the bank is unsupported, or
  the customer abandons:** the fallback control (fix (c)) reveals the details on
  demand. Criterion 14.
- **Customer abandons without triggering an error:** no error state, so no
  fallback control. They can reload `/i/[id]` and retry, or the contractor sends
  details out of band. Accepted: an abandonment is not a failure, and revealing
  details on abandonment would reopen the bypass.
- **Invoice above the ceiling:** `transfer_only` with full details, plus the
  existing `AMOUNT_TOO_HIGH` copy in `PayButton` (`:33-37`). PAY-8's constraint.
- **Invoices above the value ceiling that generate no platform fee under the
  at-source model — FLAGGED, NOT DECIDED.** Whether above-ceiling jobs should be
  genuinely fee-free or carry a different fee treatment is PAY-8's open
  decision. This ticket does not decide it and does not change their behaviour.
- **Existing contractors who rely on being paid by transfer lose the option —
  COMMS IMPLICATION, NOT ACTIONED.** A contractor whose customers habitually pay
  by transfer will see that route disappear for rail-eligible invoices. Noted
  here as required; no comms, migration or opt-out is built by this ticket.
- **Guest/preview:** `/i/[id]` requires a real invoice row; unaffected.
- **Contractor previewing their own invoice** (`user` is set,
  `src/app/i/[id]/page.tsx:71-73, 96`): sees exactly what the customer sees,
  plus the back-to-dashboard control. Unchanged.

---

## SPEC 7 — Keep the statement-of-work link inside the app session

### 1. Problem

`src/app/jobs/[id]/page.tsx:313` and `:555-560` both render:

```tsx
<InlineLink href={`/api/jobs/${job.id}/sow-pdf`} external target="_blank">
  Download statement of work
</InlineLink>
```

`InlineLink` with `external` (`src/components/ui/inline-link.tsx:42-47`) renders
a plain `<a>` rather than a Next `<Link>` and passes `target="_blank"` through.
Inside the Capacitor WKWebView, `target="_blank"` is handed to the system
browser, which carries no Supabase `sb-*` session cookie.

`/api/jobs/[id]/sow-pdf` is authenticated and tenant-scoped by design
(`src/app/api/jobs/[id]/sow-pdf/route.ts:28-49`) and is **not** in
`PUBLIC_API_ROUTES` (`src/lib/supabase/middleware.ts:6-19`, which lists
`/api/quotes/[id]/pdf` and `/api/contracts/[id]/pdf` but not this route). The
unauthenticated request therefore hits `src/lib/supabase/middleware.ts:84-88`:

```ts
if (!user && !isPublicRoute) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
```

and the contractor is shown a full sign-in page in Safari, not the route's own
401 JSON.

This is the only one of the app's four `target="_blank"` document links that
breaks: `/api/quotes/[id]/pdf` (`page.tsx:730`, `q/[id]/page.tsx:163`) and
`/api/contracts/[id]/pdf` (`c/[id]/page.tsx:139`) are all public capability
URLs, so they render fine from Safari without a session.

The href is **relative**, not an absolute `motko.app` URL — the absolute-URL
hypothesis does not hold, and no shared upstream builder connects this to the
payment-return finding.

### 2. Why it matters

**App Store risk, and it is the specific surface that already cost a
rejection.** An authenticated user tapping a control inside the app and being
ejected to a browser sign-in page is exactly the pattern that drew the 5.1.1
rejection, and resubmission draws heightened reviewer scrutiny. A reviewer
walking the primary quoting flow will tap "Download statement of work" — it sits
on the main next-step card for every draft quote (`page.tsx:313`) and on the
Scope card for every job with a SoW (`:557`) — and will be shown a login wall
while signed in. That reads as a broken or deliberately web-gated app.

Product: the SoW is the artefact the whole voice intake exists to produce, and
the contractor cannot open their own copy of it from inside the app. They are
asked to sign in again to see a document they just dictated.

Trust: being unexpectedly bounced to a browser sign-in is indistinguishable from
a phishing redirect, on an app that handles bank details.

### 3. Fix

**Keep the navigation inside the WKWebView. Do not make the route public.**

The route's tenant scoping is correct and must not be relaxed — it serves
customer PII and it is the single control preventing one trade rendering
another's job.

1. Change both call sites (`src/app/jobs/[id]/page.tsx:313`, `:557`) to a
   same-window navigation: drop `target="_blank"` and drop `external`, so
   `InlineLink` renders a Next `<Link>` and the navigation stays in the webview,
   where the session cookie is present.
2. Because the response is `Content-Type: application/pdf` with
   `Content-Disposition: inline`
   (`src/app/api/jobs/[id]/sow-pdf/route.ts:102-107`), a same-window navigation
   to it would replace the app's own view with a PDF and leave the contractor
   with no way back — this is the reason `target="_blank"` was used. So instead
   of navigating directly to the PDF, point both links at a new in-app viewer
   route, `/jobs/[id]/sow`, which is an authenticated app page that embeds the
   PDF (`<object>`/`<iframe>` at `/api/jobs/[id]/sow-pdf`, which now carries the
   session cookie because it is a same-origin subresource) and provides an
   explicit back control to `/jobs/[id]` plus a share/download action using the
   existing Capacitor Share plugin on native.
3. Add a guard so this cannot regress: an acceptance test asserting that **no**
   `target="_blank"` link in `src/app/` points at a route that is absent from
   `PUBLIC_API_ROUTES`. This is the invariant that was missing, and it is what
   makes the fix durable rather than a one-off patch.

**AASA is not part of this fix.** AASA governs inbound links from other apps into
motko.app; it cannot recapture an outbound `target="_blank"` navigation, and iOS
does not fire universal links for a navigation the app itself originates. Adding
`/api/jobs/*/sow-pdf` to
`public/.well-known/apple-app-site-association.json` would change nothing here
and is explicitly out of scope.

### 4. Acceptance criteria

1. Neither `src/app/jobs/[id]/page.tsx:313` nor `:557` renders `target="_blank"`
   or `external` on the statement-of-work link.
2. Both links resolve to `/jobs/[id]/sow`.
3. `/jobs/[id]/sow` exists, requires authentication, and returns the job's SoW
   viewer for the owning contractor.
4. `/jobs/[id]/sow` returns a 404-equivalent (indistinguishable from an unknown
   id) for a signed-in contractor who does not own the job — matching the
   existing rule at `src/app/api/jobs/[id]/sow-pdf/route.ts:42-49`.
5. `/jobs/[id]/sow` renders a control returning to `/jobs/[id]`.
6. `/api/jobs/[id]/sow-pdf` is **still absent** from `PUBLIC_API_ROUTES` in
   `src/lib/supabase/middleware.ts`, and still returns 401/redirect
   unauthenticated. The route's auth is unchanged.
7. An acceptance test enumerates every `target="_blank"` anchor under `src/app/`
   whose `href` begins `/api/` and asserts each matches an entry in
   `PUBLIC_API_ROUTES`. It fails if a new authenticated route is linked with
   `target="_blank"`.
8. The quote-PDF link (`page.tsx:730`) and contract-PDF link
   (`c/[id]/page.tsx:139`) are unchanged and still pass criterion 7, since both
   routes are public.
9. `public/.well-known/apple-app-site-association.json` is unchanged.
10. `npm run typecheck` and `npx eslint tests/acceptance/<issue>.test.tsx` pass.

### 5. Out of scope

- `/api/jobs/[id]/sow-pdf`'s authentication, tenant scoping and RLS ownership
  check — unchanged.
- Making the SoW customer-facing, or issuing a capability URL for it. It stays a
  contractor-only document. (SPEC 1 puts the *scope content* on the customer's
  quote; it does not expose this route.)
- The SoW PDF's content and layout (`src/lib/pdf/sow-pdf.tsx`).
- AASA, the associated-domains entitlement, and `appUrlOpen` handling — all
  verified correct.
- The payment-return-in-Safari finding (3b) — different mechanism, no ticket.
- Push notification deep links (`src/lib/notify-contractor.ts:36-37`) — verified
  not implicated.
- `capacitor.config.ts`, including `limitsNavigationsToAppBoundDomains`.
- The `InlineLink` primitive's API.
- Web-browser behaviour: on desktop web the link simply navigates in-tab, which
  is acceptable.

### 6. Behaviour on edge cases

- **Contractor genuinely signed out:** middleware redirects `/jobs/[id]/sow` to
  `/login` — inside the webview, where signing in returns them to the app. This
  is the correct behaviour and the whole point: the redirect now happens in a
  context that has a session to establish.
- **Session expires mid-flow:** same as above — an in-app `/login`, not a
  browser one. `native-app-init.tsx`'s existing resume-time session check
  (`:150-158`) already refreshes on app resume.
- **Link opened on desktop:** navigates in-tab to `/jobs/[id]/sow`; the back
  control returns to the job. No `target="_blank"`, so no popup blocker
  interaction.
- **Opened by a contractor who is not the job owner:** criterion 4 — an
  indistinguishable 404, never a 403 and never a redirect to another job.
- **Job has no `sow_json`:** `/jobs/[id]/sow` renders an explicit "no statement
  of work for this job yet" state rather than an empty PDF frame, mirroring the
  route's own 404 body (`route.ts:68-70`). Note that both current call sites
  already guard on `sow && sow.rooms.length > 0`, so this is reachable only by
  direct URL entry.
- **PDF fails to render:** the viewer page shows an error state with the back
  control still present; the contractor is never stranded.
- **iOS WKWebView cannot display an inline PDF in an `<object>`:** provide the
  Capacitor Share action as the guaranteed path on native, so the contractor can
  always get the file out even if inline preview fails.
- **A future authenticated `/api/` route linked with `target="_blank"`:**
  criterion 7 fails the suite. That is the regression guard.

---

# 4. DECISION NEEDED blocks

Findings 4 and 6 are recorded as resolved by the brief and are **not** re-opened
below. The blocks here are (i) the one item explicitly marked NOT FACTORY WORK,
and (ii) collisions and residual questions surfaced by the investigation that I
am not entitled to settle.

---

## DECISION NEEDED 1 — Contract immutability after signature (Finding 5)

**Status:** NOT FACTORY WORK, as directed. No spec written. Full investigation in
§1, Finding 5.

**The question.** Should a signed contract be an immutable record, with any
change appended as a **variation requiring re-signature**, or should it remain
a live projection of the current job?

**What the evidence says.** The signed contract is a *partially* frozen
artifact, and the mixture is the defect:

- Frozen: the prose. `contracts.rendered_body` is written once
  (`src/app/dashboard/actions.ts:167`) and both readers use the stored string
  (`src/app/c/[id]/page.tsx:53`, `src/lib/pdf/render-contract.ts:47`).
- Live: the money. Both readers join `quote:quotes(total, …)` and derive Total,
  Deposit and Balance on completion at view time
  (`src/app/c/[id]/page.tsx:74,108-124`; `src/lib/pdf/render-contract.ts:72` →
  `src/lib/pdf/contract-pdf.tsx:162,199-207`).
- No versioning exists: `contracts.quote_id` is UNIQUE
  (`supabase/migrations/00000000000033_dashboard_chase_indexes.sql:9`); one
  contract per quote, forever; no version column, no supersedes pointer, no
  variation table.

**Severity: HIGH, as the brief anticipated — with one qualification.** The
primary edit path is already guarded: `updateQuoteLineItems` refuses on any
status outside `["draft","sent"]`, on both the read and the UPDATE
(`src/app/jobs/actions.ts:776-782, 795`), with a comment naming exactly this
risk. But **two sibling actions have no such guard** and are reachable from the
same editor, which renders unconditionally after signature
(`src/app/jobs/[id]/page.tsx:708-724`):

- `redraftJob` (`src/app/jobs/actions.ts:506-593`), writing `line_items_json`
  and `total` at `:583-591` with no status predicate.
- `setQuotePricingMode` (`src/app/jobs/actions.ts:611-672`), writing
  `line_items_json` and `total` at `:669-670` with no status predicate.

So a contractor who redrafts or switches pricing mode after signature changes
the Total, Deposit and Balance the customer sees on the contract they signed —
in the page and in the PDF, under an unchanged signature and signature date,
with no record that it moved.

**Recommendation to Jacob (not actioned).** Under "the job is a ledger", make the
signed contract immutable and append a variation requiring re-signature. That
needs a data-model decision (variation table or version column, re-signature
flow, customer notification, what the customer sees while a variation is
outstanding) and is correctly outside factory scope.

**What I have separated out and specced anyway.** The two missing status guards
are not a product decision — they are a defect whose correct behaviour is
already written down in this codebase. Adding the same
`.in("status", EDITABLE_STATUSES)` predicate to `redraftJob` and
`setQuotePricingMode` closes the integrity hole **without prejudging** the
variation question. Raised as its own Bugs card (§5), explicitly scoped to the
guards only, and it should be reviewed on that basis. If you would rather hold
even that until the immutability decision is made, say so and I will withdraw
the card.

**Also unresolved, and yours to call:** should the quote editor be *hidden* or
disabled once a contract exists, rather than presented and then refused? Today
the contractor is offered a live editor that throws
`"This quote can no longer be edited — the customer has already responded."`
That is a UX decision downstream of the immutability one, so I have left it
alone.

---

## DECISION NEEDED 2 — Card collision: the capability-token card's Out of scope now contradicts the Finding 6 decision

**Not a re-opening of Finding 6.** The direction is settled and SPEC 6 is written
against it. This is a bookkeeping collision between two Notion cards that I must
not resolve unilaterally.

The Backlog card
[**Apply capability tokens to the public invoice page rendering payout bank
details**](https://app.notion.com/p/3b71e4f908b480439ce9c7b4a0fbe071)
(Roadmap, Module `security`) carries in its **Out of scope**:

> Do not remove bank details from the page. They belong there for the payer

SPEC 6 removes them from the rail-eligible page. The card itself already flags
that line as stale ("Out of scope now contains a revenue decision, not a design
one") and carries its own unresolved DECISION NEEDED listing three options, of
which it prefers option 3 and defers to PAY-8.

[PAY-8](https://app.notion.com/p/3bd1e4f908b48157bcc4e1eb7e55d93d) (Roadmap,
`payments`, **Shipped**, issue #240) recommends exactly the brief's direction:
*"render them only when no rail is available for that invoice — i.e. above the
ceiling, or where the contractor has no completed connected account."* PAY-8
shipped only its measurement half (`src/lib/report-off-rails-invoices.ts`,
`/api/cron/report-off-rails-invoices`) and explicitly left the decision open for
someone to close. The brief now closes it, consistent with PAY-8's own
recommendation.

**What I need from you:**

1. Confirm SPEC 6 is the closure of PAY-8's "displayed bank details" decision,
   so it can be referenced as such rather than appearing to contradict a
   Shipped card.
2. Amend the capability-token card: strike *"Do not remove bank details from the
   page"* from its Out of scope and replace its DECISION NEEDED section with a
   pointer to SPEC 6. Left as-is, whoever picks that card up will read a binding
   Out-of-scope line instructing them to undo this work.

I have not edited that card. Amending another card's scope on my own initiative
is exactly the kind of unilateral resolution the halt rule exists to prevent.

---

## DECISION NEEDED 3 — Possible duplicate: the "Pay by bank does not work" bug (Finding 3a)

The Bugs DB contains
[**"Pay by bank does not work"**](https://app.notion.com/p/3ba1e4f908b480b5890df503e05f18b0)
— Module `payment`, Status **Needs spec**. Its body is a **single screenshot and
no text**, so I cannot determine whether it reports the same defect as Finding
3a, a different payment failure, or a pre-Stripe TrueLayer-era issue.

Rule 5 says check for existing cards before creating anything. I have, and I
cannot resolve this one from the data available.

**What I did:** created the Finding 3a card as a distinct, fully-specced bug and
cross-referenced this one in its body. I did **not** overwrite or repurpose the
existing card, because writing a spec into a card whose actual report I cannot
read risks burying a different defect.

**What I need from you:** open the screenshot. If it is the pending-page
dead-end, merge the two and archive the older card. If it is something else, it
still needs a spec and is not covered by anything here.

---

## DECISION NEEDED 4 — 3b leaves one product question, not a defect (Finding 3b)

No ticket, because there is no defect: the AASA path list covers the Stripe
return URL, the file is served correctly, the associated-domains entitlement is
present, and the in-app `appUrlOpen` handler works. Evidence in §1, Finding 3b.

The residual question is a product one: **should a customer who happens to have
the Motko app installed be pulled into it when returning from their bank, or
stay in the browser?** Today the behaviour is inconsistent by circumstance —
iOS may or may not honour the universal link depending on how the redirect chain
reached motko.app and whether the user has previously chosen "open in Safari"
for the domain — and the customer-facing payment page is deliberately designed
as a public web surface that assumes no app.

Two coherent positions:

1. **Browser is correct for customers.** Remove `/i/*/paid` from the AASA paths
   so the return never bounces into the app. Consistent, and matches the design
   intent of a public capability URL. Costs nothing to customers; removes a
   convenience for the contractor testing their own invoice.
2. **App is correct when installed.** Keep the AASA entry and accept the
   inconsistency, since iOS will not guarantee handoff through a redirect chain
   regardless.

I recommend (1) for consistency, but this is a product call about the payment
experience and I am not making it. **Note:** `/i/*/paid` was added to AASA by
the shipped card *"Add associated domains and appUrlOpen handling for bank
redirect return"*, so option (1) reverses a prior decision and should be taken
deliberately rather than as a tidy-up.

---

# 5. Notion cards

All created with **`Status = Backlog`**. Nothing is marked `Ready for factory` —
promotion is Jacob's after review.

| Finding | Card | DB | Module |
|---|---|---|---|
| 1 | [Carry the scope of works onto the customer-facing quote](https://app.notion.com/p/3c11e4f908b481618bc7db00a82d305c) | Roadmap | `ui` |
| 2 | [Route every customer-facing lifecycle send through one dispatcher](https://app.notion.com/p/3c11e4f908b481e3a7e4ebda90ab5f0d) | Roadmap | `app` |
| 3a | [Payment pending page never resolves — static dead-end after bank return](https://app.notion.com/p/3c11e4f908b4813c8260df9e73b3af55) | Bugs | `payments` |
| 3b | — none (diagnosis refuted; see DECISION NEEDED 4) | — | — |
| 4 | [Internal template annotations render in customer-facing contracts](https://app.notion.com/p/3c11e4f908b4815bbdb3d5d411870a67) | Bugs | `ui` |
| 5 | — none (NOT FACTORY WORK; see DECISION NEEDED 1) | — | — |
| 5 (separable) | [redraftJob and setQuotePricingMode write quote line items with no status guard](https://app.notion.com/p/3c11e4f908b481ac9abbe0af03f6fb98) | Bugs | `data` |
| 6 | [Show bank-transfer details only when the Stripe rail cannot take the payment](https://app.notion.com/p/3c11e4f908b481c1a113fe3a646a4e40) | Roadmap | `payments` |
| 7 | [Statement-of-work link ejects the contractor to a browser sign-in page](https://app.notion.com/p/3c11e4f908b481dfb742db93e62c4ff3) | Bugs | `app` |

Each card body carries the full six-section spec from §3 (or, for the separable
Finding 5 guard defect, its own six sections).
