# Voice agent tool surface — tester handoff

Read against `main` @ `f1a1efa` (branch `claude/upbeat-babbage-nb3lsg`).

Machine-readable companion: **`docs/voice-tool-surface.json`** — the exact `tools`
arrays we POST to OpenAI, extracted from source rather than retyped.

---

## The short answer to "do you have `create_quote` / `add_line_item` / `send_quote`?"

**No. Those tools do not exist, and that is deliberate.** The voice model cannot
create a quote, cannot add or edit a line item, cannot price anything, and cannot
send anything to a customer.

There are **five** separate Realtime sessions, each minted with its own
instructions + tool list. Seventeen tool definitions in total:

| Session | Tools | Can it write to the DB? |
|---|---|---|
| Job intake — **guest** (no account) | `update_sow`, `finish_job`, `wrap_up` | **No.** Reads no table, writes no table. |
| Job intake — **authenticated** | the three above + `record_first_name`, `record_person` | Only `jobs.sow_json`, `contractors.first_name`, `team_members` |
| **Setup interview** | `update_business_setup`, `record_person`, `finish_setup` | `contractors`, `team_members` |
| **Cost intake** | `draft_cost` | Nothing directly — drafts only; a separate action commits |
| **Ledger query** | `get_owed_to_you`, `get_you_owe`, `get_you_owe_counterparty`, `get_job_profit`, `get_whats_left` | **Read-only** |

Of those seventeen, only **three** carry model-authored data that reaches
persisted state (`update_sow`, `update_business_setup`, `record_person`), one
drafts (`draft_cost`), five read, and the rest are flow control with empty
parameter objects.

### Where the quote actually comes from

```
voice call  ──update_sow──▶  jobs.sow_json   (deterministic merge, server-side)
                                   │
      wrap_up / finish_job         ▼
                        completeSowConversation()   ← server action, authenticated
                                   │
                                   ▼
                        Anthropic drafting call + deterministic pricing
                                   │
                                   ▼
                            quotes.line_items_json  (draft)
                                   │
            contractor reviews in the UI, then presses Send
                                   ▼
                             sendQuote()   ← server action, authenticated
```

The model never sees the pricing engine and is never in the send path. Anything
it "says" about money is transcript, not state — with the two exceptions flagged
under *Attack notes* below.

---

## Session 1 — Job intake (guest)

- **Mint:** `POST /api/guest/realtime-session` → `{ clientSecret }`
- **Auth:** none. This is the only unauthenticated server call the guest voice path makes.
- **Rate limit:** 5 per IP per hour, **fails closed** (limiter that cannot answer denies). `429` with `Retry-After`, or `503`.
- **Source:** `src/app/api/guest/realtime-session/route.ts`, `src/lib/voice/job-intake-prompt.ts`
- **Tools:** `BASE_REALTIME_TOOLS` only — the account tools are withheld, so a guest session has no tool that can reference a row.

## Session 2 — Job intake (authenticated)

- **Mint:** server action `createRealtimeSession({ jobId? })` — `src/app/jobs/actions.ts:115`
- **Auth:** Supabase session; throws `Not authenticated` with no user.
- **Tools:** `BASE_REALTIME_TOOLS` + `ACCOUNT_REALTIME_TOOLS`
- **Client dispatch:** `src/components/voice/job-intake.tsx:855` (`handleToolCall`)

Tool → effect:

| Tool | Effect |
|---|---|
| `update_sow` | → `saveSowDelta` server action → `mergeSowToolDelta` → `jobs.sow_json`. Merge is deterministic; the model emits a **delta**, never the full state. |
| `finish_job` | Flow control only. Advances to follow-ups or wrap. |
| `wrap_up` | Flow control only. Ends the call, triggers drafting. |
| `record_first_name` | → `saveContractorFirstName` → `contractors.first_name` |
| `record_person` | → `recordTeamMember` → `team_members` row (name, role, day_rate) |

`update_sow`'s parameter schema is the large one — `SOW_DELTA_TOOL_PARAMETERS`
in `src/lib/schemas/sow.ts:360`. It is the richest model-authored input in the
product and the one worth the most of your time.

## Session 3 — Setup interview

- **Mint:** server action `createSetupRealtimeSession()` — `src/app/setup/actions.ts:257`
- **Tools:** `SETUP_TOOLS` (`src/app/setup/actions.ts:205`); `update_business_setup` uses `BUSINESS_SETUP_DELTA_TOOL_PARAMETERS` (`src/lib/schemas/business-setup.ts:87`)
- Writes company name, trade, VAT status, rates, contract profile fields.

## Session 4 — Cost intake

- **Mint:** server action `createCostRealtimeSession()` — `src/app/costs/actions.ts:33`
- **Tool:** `draft_cost` — **note the two structural defences here**, both worth probing:
  - `amount_words` is a **string of the contractor's exact words** ("two eighty"), not a number. Parsing is deterministic and happens outside the model.
  - `job_spoken_words` is likewise the contractor's own phrase. There is **no `job_id` field** — deliberately, so a model guess has nothing to travel in. (Regression from #274: two "Smith" jobs resolved to whichever the model preferred, ownership checks passed, and the cost landed on the wrong P&L.)
- Commit path: `completeCostCapture` → `createJobCost`.

## Session 5 — Ledger query (read-only money questions)

- **Mint:** `POST /api/ledger/query-session`
- **Auth:** Supabase session required; `401` unauthenticated, `403` if no contractor row.
- **Rate limit:** 10 per contractor per hour.
- **Client dispatch:** `src/app/ledger/query/page.tsx:135`
- Every handler calls its server action **with no contractor id** — the id comes from the session. The `contractorIdOverride` parameters you'll see in `src/app/ledger/query-actions.ts` throw unless `NODE_ENV === "test"`.
- Results are **formatted into English sentences server-side** before crossing into the session — the model never receives a pence integer, so there is no arithmetic for it to get wrong.

---

## The other structured interface: server actions

Most of the mutation surface is **Next.js server actions**, not REST. They are
POST endpoints reachable by any authenticated client that can produce the
action id (the `Next-Action` request header), so they are absolutely worth
testing independently of the UI — the UI's guards are client-side, the action's
are not.

Quote lifecycle, all in `src/app/jobs/actions.ts` unless noted:

| Action | Input schema | Notes |
|---|---|---|
| `createManualJob` | — | Non-voice fallback; creates empty draft job + quote |
| `saveSowDelta` | `{ jobId: uuid, delta: unknown }` | `delta` is deliberately `unknown` at the boundary, then parsed by `sowDeltaSchema` |
| `completeSowConversation` | `{ jobId, transcript?, conversationTurns?, … }` | Triggers drafting |
| `redraftJob` | `{ jobId: uuid }` | |
| `setQuotePricingMode` | — | |
| `updateQuoteLineItems` | `{ jobId, quoteId, lineItems[], customer? }` | The line-item write path |
| `sendQuote` | `{ jobId, quoteId, customer, confirmZeroTotal, confirmNarrativeMismatch, confirmOverCeiling, channels }` | Guards in `src/lib/quote-send-guards.ts` |
| `deleteDraftJob`, `markWorkComplete`, `archiveQuote`, `createContract`, `createInvoice` | | `src/app/dashboard/actions.ts` for the last three |
| `acceptQuote` / `declineQuote` | | `src/app/q/[id]/actions.ts` — **customer-facing, unauthenticated by design** |
| `signContract` / `declineContract` | | `src/app/c/[id]/actions.ts` — same |

Note the three `confirm*` booleans on `sendQuote`. Each one is set **by the
client** after the contractor acknowledges a warning (zero total, narrative
figure disagreeing with the priced total, quote over the Pay-by-Bank ceiling).
A caller that simply sets all three to `true` skips every one of those
confirmations. That is intended — they are confirmations, not authorisations —
but it is exactly the sort of thing worth writing up if you disagree.

## Public HTTP routes

Pinned by `tests/acceptance/99.test.ts`, which fails if an unlisted route
appears under `src/app/api/`:

```
/api/guest/realtime-session      /api/quotes/[id]/pdf
/api/invoices/[id]/payment-status   /api/contracts/[id]/pdf
/api/invoices/[id]/transfer-details /api/stripe/create-payment-intent
/api/stripe/webhook                 /api/twilio/inbound
/api/cron/chase                     /api/cron/reconcile-free-jobs
/api/cron/report-off-rails-invoices /api/monitoring
```

Everything else under `/api/` is session-gated by middleware.

---

## Attack notes — where we'd look first

1. **`update_sow` → `pricing.fixed_amount`.** This is the one place a
   model-authored *number* becomes a price: it is taken as the contractor's
   stated NET total for the whole job, with VAT added on top. Note the gap
   between prompt and merge — the tool description tells the model "never send
   `fixed_amount` on its own", but `resolvePricingModeFromDelta`
   (`src/lib/schemas/sow.ts:185`) *promotes* a bare positive `fixed_amount` to
   `mode: "fixed"` rather than rejecting it. That is a deliberate decision
   (naming a number is choosing a fixed price, and the alternative was a
   default that manufactured an answer), but it means a single
   `{"pricing":{"fixed_amount":N}}` delta sets the job's price with no mode
   ever stated. `mode` itself carries no default — an absent one stays absent
   and the question gets re-asked.
2. **`update_sow` → `agreed_costs.{day_rate, fixed_price, deposit_amount}`.**
   Same class: model-authored GBP figures describing what was allegedly already
   agreed with the customer. `nothing_agreed: true` is the "asked and confirmed
   nothing" sentinel — check what an *absent* `agreed_costs` does versus an
   empty object.
3. **`update_sow` → customer PII fields.** `customer_name`, `site_address`,
   `customer_phone`, `customer_email` are free-text and model-authored, with no
   format validation on the merge — they flow to the quote/contract documents
   and to the send channels. (Separately: `contact-detail-guard.ts` redacts
   spoken phone numbers *out of the transcript* before price extraction runs, so
   "the contact number is 07479 556410" stops becoming a £563,889 stated price.
   It guards the transcript path, not these fields.)
4. **`saveSowDelta` ownership.** It selects and updates `jobs` by id with no
   explicit contractor check; isolation relies entirely on Supabase RLS through
   the user-scoped client. Worth confirming directly with a second account's
   job id.
5. **`record_person` → `day_rate`.** A model-authored number that is persisted
   to `team_members` and then used to price *future* quotes. Note `role` is not
   required while `day_rate` is.
6. **Guest rate limiter keying.** `clientIpKey(request.headers)` —
   header-derived, so worth checking which header it trusts and whether it is
   spoofable behind Vercel.
7. **`declined_slots`.** An enum array the model can populate to make a required
   question *stop being asked, in this call and the next*. It is the one field
   whose whole purpose is suppressing a mandatory prompt.
8. **Amount-words parsing.** `draft_cost.amount_words`, and the transcript
   price extractor in `src/lib/voice/stated-prices.ts`, turn free text into
   money. It has a live history of getting this wrong in chargeable ways —
   "twenty-two thousand pounds" parsed as £1,000 because the hyphen was not
   stripped during phrase scanning. Adversarial phrasings belong here.

## Reproducing a raw session

The browser talks **directly** to OpenAI over WebRTC after the mint — audio,
transcripts and tool calls never traverse our server. So to drive the structured
interface without the voice UI:

1. `POST /api/guest/realtime-session` (or invoke the relevant server action) to get a `clientSecret` — short-lived, ~1 minute.
2. Open the Realtime connection with it; the session already carries the instructions and tools.
3. Inject `conversation.item.create` text items and read back `response.function_call_arguments.done` frames. That is what `src/components/voice/job-intake.tsx` does.

Handler-level testing without OpenAI at all: call the server actions directly
with your own arguments — `saveSowDelta({ jobId, delta })` accepts anything the
merge will take, which is the shortest path to the interesting half.
