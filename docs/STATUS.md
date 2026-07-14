# Motkoquote — Project Status

_Snapshot generated 2026-07-13. Reflects `main` @ `f848de9` (clean tree, in sync with `origin/main`)._

## 1. What this is

**Motko** (product name in-app; repo `motkoquote`, live at **motko.app**) is an
AI back-office for small UK trade businesses (2–10 person builders, electricians,
plumbers, roofers). The core loop: a tradesperson has a **spoken conversation** on
site, and the app turns it into a **Statement of Work → priced quote → PDF →
tracked customer link → contract → invoice → payment chase**, backed by a
per-contractor **knowledge layer** that learns their rates, suppliers, and past jobs.

Guardrails baked into the design: human-in-the-loop (nothing sends without review),
**all money arithmetic is done in code, never by the LLM**, and every AI-generated
quote flags its assumptions explicitly.

## 2. Stack (as actually built)

| Layer | Choice |
|---|---|
| Framework | Next.js **16.2.10** App Router (RSC + Server Actions), React **19.2.4** |
| Styling | Tailwind CSS **v4** (CSS-first `@theme inline`), TypeScript strict |
| DB | Supabase Postgres + **pgvector**, Row-Level Security on every tenant table |
| Auth | Supabase Auth (password + magic-link), middleware route gating |
| Voice | **OpenAI Realtime API** over WebRTC (`gpt-realtime-mini`, `gpt-4o-mini-transcribe`, semantic VAD) |
| LLM | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — quote drafting + SoW narrative |
| Embeddings | OpenAI (knowledge layer, 1536-dim vectors) |
| Payments | Stripe (invoices + payment links + webhook) |
| Email | Resend (branded auth templates + quote/invoice/chase mail) |
| PDF | `@react-pdf/renderer` (quote, SoW, contract) |
| Enrichment | Companies House (company lookup), Google Places New (address autocomplete) |
| Scheduling | Vercel Cron → `/api/cron/chase` daily at 08:00 |
| Hosting | **Vercel** (`vercel.json` crons; motko.app) |

> ⚠️ **Doc drift:** the README still lists Whisper for STT and Railway/Twilio as
> primary paths. The real voice path is the OpenAI **Realtime** API (`src/lib/realtime.ts`),
> hosting is Vercel, and Twilio is present only as env scaffolding for the SMS chase
> channel. README should be refreshed.

## 3. Feature status

### Working end-to-end
- **Auth & onboarding** — signup (email/password, now linked from `/login`), magic-link
  sign-in, branded Supabase auth emails, `/auth/confirm` route, setup-incomplete fallback
  that routes an unfinished contractor to `/setup/voice` or manual `/setup`.
- **Business setup** — both a **voice-driven** wizard (`/setup/voice`) and a manual form
  (`/setup`): company details via Companies House lookup, VAT, day/overtime/callout/travel
  rates, markup, team members, merchant trade-discount accounts, rate cards, quote footer,
  Google Places address autocomplete.
- **Voice job intake → quote** — `/jobs/new` runs a live duplex conversation, extracts a
  structured Statement of Work, Claude drafts line items (assumptions flagged, code does the
  maths — `src/lib/quote-math.ts`), editable quote editor, quote + SoW PDFs. Interview is
  steered by **question packs** (`src/lib/question-packs/`) with keyword matching + a
  fallback path, **rate-card matching** (`src/lib/rate-card-matching.ts`), per-line
  **multipliers**, mid-interview **reclassification**, and fallback telemetry (PR #5).
- **Customer-facing flow** — tracked quote link `/q/[id]` (view + accept/decline), contract
  `/c/[id]` (view + sign/decline), paid-invoice receipt `/i/[id]/paid`, address-check `/i/addr-check`.
- **Contracts** — structured templates with business profile + per-job variables, markdown
  rendering, contract PDF.
- **Invoicing & chasing** — deposit/final invoices, Stripe payment links, Stripe webhook,
  daily chase cron.
- **Knowledge layer** — embed past quotes, retrieve similar past jobs, material-price memory,
  rate cards; surfaced back into the quote-drafting prompt.
- **Dashboard** — a "receipt" hub: outstanding quotes, accepted-awaiting-contract,
  contracts awaiting signature, signed/declined, accepted-awaiting-invoice, unpaid invoices,
  plus a missing-business-details warning. Primary CTA "New quote".
- **Design system** — Airbnb-inspired tokens (airy, image-forward, neutral canvas) with
  **British Racing Green (#004225)** replacing Airbnb's Rausch red, applied across primitives
  and customer screens. Single source of truth in `src/app/globals.css`, consumed via CSS
  custom properties + Tailwind `@theme` aliases.

### Data model (13 migrations)
`contractors → team_members / merchant_accounts / customers / jobs → quotes → invoices →
chase_events`, plus shared `merchants` / `material_prices`, `knowledge_chunks` (pgvector,
HNSW cosine index), and later additions: quote status events, rate cards, conversational SoW,
contracts + templates + per-job contract input, business_profile / business-setup. RLS scopes
every tenant table to `owner_user_id = auth.uid()`; merchants + material_prices are shared
read-only reference data.

## 4. Repo / delivery state

- **Branch:** `main` @ `f848de9`, clean tree, in sync with `origin/main`. PRs #1–#5 are all
  merged (auth email templates, auth/confirm logging, voice-setup transcript + retry,
  setup-incomplete fallback, and the voice-quoting design-review gap closure).
- **Quality gates (verified this snapshot):**
  - `vitest run` → **23 tests passing across 5 files** — `quote-math`, `rate-card-matching`,
    `question-packs/match`, `question-packs/fallback`, `schemas/sow`.
  - `tsc --noEmit` → **clean** (TypeScript strict).
- **Live deploy:** everything on `main` is deployed to Vercel (motko.app), including the
  account-creation entry point and the voice-setup / address-autocomplete / setup-fallback
  work that previously sat on a feature branch.
- **Git identity:** recent commits landed under the auto-configured
  `Jacob Buckland <jacob@Mac.mynet>` — worth setting explicitly.

## 5. Gaps & risks

1. **Test coverage is thin, not absent.** A harness now exists and covers the money-critical
   `quote-math` plus rate-card / question-pack logic. Still uncovered: **invoice amount
   logic** (`src/lib/invoicing.ts`), the Stripe webhook, and the chase cron — all
   money-adjacent and worth tests next.
2. **README is stale** (lists Whisper/Railway/Twilio vs. the actual Realtime/Vercel path) —
   misleads a fresh setup. Should be refreshed to match §2.
3. **External key dependencies** — Realtime voice needs `OPENAI_API_KEY`; address autocomplete
   silently degrades to plain text without `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; chase/cron needs
   `CRON_SECRET`. Confirm these are set in Vercel prod.
4. **Twilio SMS chase** is scaffolded in env but the implemented chase path is email (Resend);
   SMS is not wired.
5. **Realtime voice cost/latency** is unmeasured — no telemetry on session length or spend per
   job beyond the fallback counters added in PR #5.

## 6. Suggested next steps

- Extend the test suite to `invoicing.ts` (invoice amounts / deposit-vs-final) and the Stripe
  webhook state transitions — the remaining money-critical paths.
- Refresh the README stack table and setup instructions to match reality (§2).
- Verify prod env keys (OpenAI, Google Maps, Stripe webhook secret, CRON secret) in Vercel.
- Decide whether SMS chasing is in scope; if not, drop the Twilio env scaffolding.
- Set an explicit git author identity to stop commits landing as `jacob@Mac.mynet`.
