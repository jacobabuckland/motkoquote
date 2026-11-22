# Motko PA rebuild — plan and build loop

_Written 22 Nov 2026 against `main` @ `4169612`. Owner: Jacob._

## Goal

Make Motko a tradesperson's personal assistant: a persistent conversation you
text or speak to, rather than a set of forms with voice bolted on. The
conversation is the app. Pages and forms become the fallback.

A contractor should be able to text "quote Dave 3 days rewiring the kitchen",
get a quote back as a card in the thread, say "make it 850" or "add skip hire",
and say "send it", without opening an editor.

## Decisions (Jacob, 22 Nov)

1. **The mandatory-slot invariant is replaced by propose-then-correct.** The old
   rule made voice intake interrogate the contractor for crew size, pricing mode
   and materials supply. The new rule keeps its *intent*, which is that these are
   never silently guessed. The draft shows all three as **visible, tappable
   assumptions** on the quote card, and the agent may ask only about things that
   change the price. A draft with an unconfirmed pricing mode can be shown but
   **cannot be sent** until the contractor confirms it.
2. **In-app thread first.** WhatsApp (via the existing Twilio account) is a later
   channel. Plain SMS is not planned.
3. **iOS is shipped but has no downloads.** There is no live-user data to
   protect, so schema additions and a changed home route are low risk.

## Scope of Phase 1 (this loop)

**In:**
- A conversation store: threads and messages, owned by a contractor, with RLS.
- One agent endpoint: text in, text and structured cards out, with a tool loop.
- Tools wrapping existing server actions and lib code (see below).
- A confirmation gate so nothing sends, pays or deletes without an explicit yes.
- A `/chat` route: thread, composer, "needs you" strip, quote card.
- Tests for the new logic, with the LLM injected so tests never call a network.

**Out (later phases):** voice in the thread, the proactive daily brief, WhatsApp,
flipping `/` and `/dashboard` to the thread, deleting old pages, migrating the
realtime voice model.

## Architecture

**Tables** (new migration, next free number): `pa_threads`
(`id`, `contractor_id`, `created_at`, `updated_at`) and `pa_messages`
(`id`, `thread_id`, `contractor_id`, `role` user|assistant|tool, `content`,
`cards` jsonb, `tool_calls` jsonb, `channel` default `app`, `created_at`).
RLS: a contractor reads and writes only their own rows. Add a
`pa_pending_actions` table (or equivalent) for the confirmation gate: an action
name, validated args, the thread, an expiry, and `confirmed_at`.

A confirm tap **spends** the pending action before the action is re-checked, so
the row also records what then happened: `outcome` (`done` or `refused`) and the
words the contractor was shown. A second tap reports that real outcome. It reads
"already done" only if the first tap succeeded, repeats the refusal if it was
refused, and says it can't tell if no outcome was ever recorded (the request died
mid-flight). The migration's trigger allows exactly two updates to a pending row:
the claim, and recording the outcome once.

**Agent loop** (`src/lib/pa/`): a pure function taking an injectable `LlmClient`,
the thread history, the contractor context and a tool registry. It loops
tool-call to tool-result until the model returns text, with a hard cap on
iterations. The real client uses `@anthropic-ai/sdk` with the model named in
`src/lib/models.ts`. Tests use a scripted fake.

**Tools** (each a thin wrapper, input validated with zod, returning data the
model narrates and, where relevant, a card for the UI):

| Tool | Wraps | Kind |
|---|---|---|
| `get_needs_attention` | `job-stages` situations where the next move is the contractor's | read |
| `list_jobs` / `get_job` | existing job and quote queries (`get_job` also shows the quote card) | read |
| `get_money_position` | `getMoneyPosition` | read |
| `create_quote_draft` | text description, SoW delta through the injected LLM, `createManualJob`, `saveSowDelta`, `redraftJob` | write (draft only) |
| `update_quote` | `updateQuoteLineItems`, `setQuotePricingMode`, customer details | write (draft only) |
| `set_assumption` | records the contractor's stated pricing mode, crew or materials supply on a draft. It **un-confirms** the slot; only the contractor's tap on the card confirms | write (draft only) |
| `propose_send_quote` / `propose_create_invoice` / `propose_mark_paid` / `propose_delete_draft` | write a `pa_pending_actions` row and return a confirm card | gate |

**There is no `confirm_action` tool.** The model holds no tool that executes a
pending action. Executing is `confirmPendingAction` in `src/lib/pa/pending.ts`,
reached only from a server action in `src/app/chat/actions.ts`: a separate
authenticated request made by the contractor's browser when they tap the confirm
card. That is what stops customer-supplied text in a job, or a model that has
been talked round, from confirming anything. The card's own **Send** button does
not send either: it makes the same pending action and shows the confirm card.

Chat-made drafts are unconfirmed by construction: the assumptions row is created
the instant the job is, before anything that can fail, and a draft that fails
part-way is deleted. Only a job with no row at all (a voice-captured job) counts
an answered slot as confirmed. The tap confirms the value the contractor saw: if
it has changed since the card was drawn, the tap is refused and the card
refreshed. At most one send proposal is live per job.

A confirmation is honoured only for the same contractor and the same thread,
before expiry, once (one conditional `UPDATE` claims it), and only if the thing
proposed is still true at execution: the quote's lines, total and recipient (name, email, mobile) match what the
card showed, and all three assumptions are still confirmed.

Sending a quote, creating an invoice, marking paid and deleting are **only**
reachable through `propose_*` and then the contractor's own confirm tap. The
model cannot call the underlying action directly.

**UI** (`/chat`): message list with user and assistant bubbles, a composer with
text input and a send button, a mic button present but disabled with a clear
label (voice is Phase 2), an amber "needs you" strip at the top driven by
`get_needs_attention`, and a **quote card** (total, line summary, the three
assumptions as tappable chips, Send and Change buttons). Add "Chat" to the app
header. Use existing design tokens and components (`Card`, `Button`, `Money`,
`StatusChip`). Honour the safe-area and 44px-target conventions already in the
codebase. The existing pages stay live and unchanged.

## Product guardrails that stay

These are about money and customers, not process, so they stay unless you strike
them here.

- The model never does arithmetic. Totals come from existing code (`quote-math`).
- The model never invents rates or market prices. It prices from the contractor's
  own rates, rate cards and stated figures, or it says it cannot price a line.
- Nothing is sent to a customer, charged, paid or deleted without an explicit
  confirmation recorded server-side.
- User-facing copy is en-GB and short. Replies read like texts, not reports.
- Customer PII is not written to logs, and thread content is deleted by the
  existing account-erasure path.

## Process rules set aside for this work

Per Jacob, the repo's own process rules do not bind this work: the factory
pipeline and Notion polling, frozen acceptance tests, the escalation list, the
design-rule guards and the old voice invariant. If an existing test fails because
the new feature legitimately conflicts with it, the Builder may edit it and must
list every such edit in the round report. Nothing may be pushed to `main`, and
no migration may be applied to production by an agent.

## The loop

Two agents, two rounds. Each agent works in this repository on branch
`claude/remove-your-rates-settings-vyc4h6`.

**Round 1.** The Builder implements Phase 1 from this document and commits. The
QA agent then reviews the result, runs typecheck, lint and the full test suite,
and tries to break the confirmation gate. It reports defects, ranked, with
evidence, and does not edit code.

**Round 2.** The Builder fixes every defect QA reported (or states why not) and
commits. The QA agent re-verifies each reported defect, re-runs everything, and
looks for regressions the fixes introduced.

**Exit.** After round 2 the loop stops, whatever the state. Anything still open
is listed in the final report rather than carried into a third round.

### QA's acceptance checklist

1. `npm run typecheck` clean, `npm run lint` with 0 errors, `npx vitest run` green
   apart from tests the Builder listed as deliberately edited.
2. The agent loop terminates: a model that always asks for a tool hits the
   iteration cap and returns a safe message.
3. No tool path sends a quote, creates an invoice, marks paid or deletes without a
   matching, unexpired, same-contractor, same-thread confirmation.
4. A second contractor cannot read or act on the first contractor's threads,
   messages or pending actions (RLS in the migration, and ownership checks in
   code).
5. A draft with an unconfirmed pricing mode, crew size or materials supply cannot
   be sent, and the quote card shows all three as assumptions.
6. No tool computes money in the model. Totals shown on a card equal what
   `quote-math` returns for the same line items.
7. `/chat` renders for a signed-in contractor and redirects a signed-out visitor
   to login, matching how other authenticated pages behave.
8. Prompt-injection check: customer-supplied text inside a job (name, address,
   notes) cannot cause the agent to call a write tool.

## Follow-ups outside this loop

- **Realtime voice model deadline.** `src/lib/models.ts` records that OpenAI
  retires `gpt-realtime-mini` on 20 Jan 2027. This is independent of the rebuild
  and still needs doing.
- Per-contractor spend caps and maximum call length before voice goes into the
  thread. The signed-in intake session currently has neither.
- Phone-number verification before any SMS or WhatsApp channel.
- A conversation-shaped voice harness; the current one is interview-shaped.
- The migration in this loop must be applied by a human with `supabase db push`
  before the code is deployed.
