# Motko Live-Test — Phase 1 Diagnosis (read-only)

**Tree:** `main` @ `20e5891` · **Test session:** ~21:45–22:10, 26 Jul, production (motko.app), demo account (Meg's Plumbers / customer Sheila).
**Status:** Diagnosis only — **no code changed.** I have no prod DB/log access in this environment, so rows marked _needs-Jacob_ must be confirmed by you.

🛑 **HARD STOP after this report.** Nothing implemented; awaiting approval on which items to fix in Phase 2.

---

## Findings

### 1. Voice quote asks too little — **verdict (b)+(c), not a regression of the slot definitions**

- **Root cause:** The five checklist slots + the pricing-mode question are **deliberately not** in the live session instructions. They're asked by a **client-driven "followup" phase**. But the manual **"Done" button** (and the question/time caps) call `finishConversation()` **directly**, bypassing `maybeStartFollowups` / `concludeOrAskRequired`. End the call via "Done" → none of it is asked.
- **Evidence:** instructions omit pricing-mode and say _"Do not proactively ask about any of these five"_ — `src/app/jobs/actions.ts:180-259`; the question lives in the post-call checklist — `src/lib/schemas/sow.ts:707`; followup engine — `src/app/jobs/new/page.tsx:461-505`; **bypass** — `src/app/jobs/new/page.tsx:1050` (`finishConversation("manual")`), `:800`, `:804` (caps).
- **Proposed fix:** route manual "Done" (and the caps, bounded) through `concludeOrAskRequired` so the 3 required slots (crew, duration/pricing-mode, materials) are asked before drafting; wrap-up cannot fire while required slots are unasked.
- **Effort:** M · **Risk:** med (live-call control flow; must not reopen the ask-loop — `concludeOrAskRequired` is already capped).
- **Needs-Jacob:** pull tonight's `voice_session_completed` row (`wrap_reason`, `required_slots_asked/answered/unknown`, `pricing_mode`) to confirm the Done/cap path. **Decision:** should "Done" detour to ask the 3 required slots, or hard-exit?

### 2. Send quote hangs on "Sending…"

- **Root cause:** **No timeout anywhere** in the send path. `sendQuote` awaits `renderQuotePdf`, then `Promise.all([email, sms])`; a **hanging** (not erroring) Resend/Twilio/PDF call never resolves → the action never returns → the client `useTransition` stays on "Sending…". Status flips to `sent` only **after both channels settle** (no first-successful-channel flip). No `fetchWithTimeout` util exists.
- **Evidence:** `src/app/jobs/actions.ts:1035` (`renderQuotePdf` — `.catch` but no timeout), `:1040-1067` (Promise.all; status update at `:1067`); `src/lib/email.ts:31` (Resend, no timeout); `src/lib/sms.ts` raw `fetch`, no `AbortSignal`; client `src/app/jobs/[id]/quote-editor.tsx:289-316` (no client-side timeout).
- **Proposed fix:** shared `withTimeout` (Promise.race + `AbortSignal.timeout`) around PDF / Resend / Twilio (~10–12s each); the action always resolves; flip status on first channel success. **Test:** fault-inject a hanging email send; assert the action resolves within the timeout.
- **Effort:** M · **Risk:** med (money-adjacent send path; preserve idempotency).
- **Needs-Jacob:** logs / `client_errors` ~21:56 — did it **hang** (no error) or **error-and-swallow**? Did the quote's status flip to `sent`? (tells us where it hung.)

### 3. Quote email attaches a PDF that can't accept — _decision pre-made_

- **Root cause / current behaviour:** the rendered PDF is attached to the quote email, and the body link is a plain "View your quote".
- **Evidence:** `src/app/jobs/actions.ts:1035`, `:1046-1057` (pdfAttachment passed); `src/lib/email.ts:19-51` (attach `40-42`, link `38`).
- **Proposed fix:** drop `pdfAttachment`; email becomes a short summary + prominent **"View and accept your quote"** button (tracked `/q/` link); PDF stays downloadable on `/q/`. Update email tests.
- **Effort:** S · **Risk:** low.
- **Needs-Jacob:** should the `/q/` link carry a tracking token? It's currently the bare quote UUID.

### 4. Contract form ignores captured data

- **Root cause:** prefill reads the **legacy `extracted_json`** (`access_issues` / `timeline`), not the current structured **`sow_json`** — empty for SoW-captured jobs. `materials_by` / `materials_notes` and `warranty_period` are **never wired** into `initialJobInput`; the profile default warranty is never applied.
- **Evidence:** `src/app/jobs/[id]/page.tsx:115` (`extraction = extracted_json`), `:283-289` (only scope/access/duration, sourced from `extraction.*`); `sow` is parsed but unused for prefill at `:126-127`; form fields default to `""` — `src/app/dashboard/create-contract-form.tsx:45-52`.
- **Proposed fix:** source prefill from `sow` (`materials_supply` → by/notes; `deadline`/`duration_days` → duration; access), `warranty_period` ← contractor profile default; all editable; verify they flow into `buildContractVariables` → rendered clauses.
- **Effort:** M · **Risk:** low-med.
- **Needs-Jacob:** which `business_profile` field holds the "standard warranty" default?

### 5. Contract form still shows after sending

- **Root cause:** the client navigation to the sent-view is **gated on `res.delivered`** — on non-delivery (no/failed customer email) it keeps the form mounted + a copy-link panel instead of transitioning. The contract row **is** created `status:"sent"`; `deriveSituation` is correct. The **canonical single-source rule holds** — the client just doesn't reflect it.
- **Evidence:** `src/app/dashboard/create-contract-form.tsx:95-115` (`if (res.delivered && jobId) push`); insert + revalidate — `src/app/dashboard/actions.ts:154-193`; `src/lib/job-stages.ts:143`; `src/app/jobs/[id]/page.tsx:99` (`.maybeSingle()`), `:151-152`.
- **Proposed fix:** navigate to contract-sent whenever `res.contractId` exists, regardless of delivery; surface delivery status + copy-link on the waiting view; add "Amend and resend" **only** if that path exists, otherwise a view-only link + flag the gap. **Test:** `createContract` returns `delivered:false` → form is gone (waiting state renders).
- **Effort:** S-M · **Risk:** low.
- **Needs-Jacob:** on a **fresh reload** of tonight's job — does it show "waiting" or the form? (distinguishes the client-nav bug from a contracts SELECT-RLS / read gap.)

### 6. Fee billing section renders while unavailable

- **Root cause:** `FeeBillingSection` is rendered **unconditionally** on settings — not gated by `isFeeBillingEnabled()`. The action guards (returns "isn't available yet"), but the live-looking button is a dead end.
- **Evidence:** `src/app/settings/page.tsx:69`; `src/lib/fee-billing-flag.ts:6`; `src/app/settings/fee-billing-actions.ts:24-27`.
- **Proposed fix (Phase-1 recommend; implement in Phase 2 only if approved):** gate the settings section on `isFeeBillingEnabled()` (hidden-until-configured), consistent with "fee billing stays dark".
- **Effort:** S · **Risk:** low.
- **Needs-Jacob:** confirm hidden-until-`FEE_BILLING_ENABLED` is intended (vs merchant-account presence).

### 7. Payment "couldn't start" on the `/i/` pay-by-bank page (~22:07)

- **Root cause:** the route passes its **own** config gate (client id/secret present) but `createTrueLayerPayment` **throws** when the **signing pair** (`TRUELAYER_SIGNING_KID` / `TRUELAYER_SIGNING_PRIVATE_KEY_B64`) is absent — and the route has **no try/catch and no error logging**, so it's an unhandled 500 with the TrueLayer body discarded. `TRUELAYER_ENV` defaults to `sandbox` unless `="live"` (secondary suspect: live/sandbox credential mismatch).
- **Evidence:** `src/app/api/truelayer/create-payment/route.ts:37-40` (gate = client creds), `:88-105` (no try/catch, no `logError`); `src/lib/truelayer.ts:98-100`, `:126-127`, `:46`; `src/lib/truelayer-payments.ts:109-111` (`throw` if `!signing`).
- **Proposed fix:** add error-body logging (Phase-1 exception, below); return a clean 502; move the signing check into the top gate (→ 503, legible) in Phase 2.
- **Effort:** S · **Risk:** low.
- **Needs-Jacob (env — never printed):** add `TRUELAYER_SIGNING_KID` + `TRUELAYER_SIGNING_PRIVATE_KEY_B64` to prod; verify `TRUELAYER_ENV` matches the credential type (live vs sandbox); confirm the demo contractor's `payout_details_complete` + sort/account values. **Approve the read-only logging change + one retry** to capture the exact TrueLayer error body?

---

## Cross-cutting

Items **2, 5, 7** share one root: **outbound calls have no timeouts and inconsistent error logging** (OpenAI token `src/lib/realtime.ts:26`, Resend, Twilio, TrueLayer, PDF render). A single `withTimeout` helper + consistent `logError` would harden all three at once — better as shared infra in Phase 2 than three point-patches.

## Item 7 read-only exception

Per the prompt I _may_ add error-body logging in Phase 1 so you can retry once and capture the real TrueLayer failure. **I have not made that change** — it's the one Phase-1 edit I'll do only on your go (then you retry the `/i/` payment once).

---

## Recommended Phase 2 batch

- **Now (low-risk, self-contained):** items **3, 4, 5, 6** + shared **timeout/logging infra** covering **2 & 7**.
- **Pending:** item **1** — needs your "Done"-button decision + the `voice_session_completed` row.
- **Yours before item 7's code lands:** the TrueLayer signing env vars + `TRUELAYER_ENV` check.

**Fences respected:** no pricing/fee changes (invariant 10); fee billing stays dark; no real TrueLayer payments; any migrations flagged for manual push.
