# Design rules — Motko

Durable record of design decisions and their rationale. Supersedes any design-handoff bundle, spec HTML, or `tokens.css` you may encounter; those were working documents and are not authoritative.

Sits alongside `docs/design-direction.md`, which is the taste document — subject, audience, the visual language and why. That one says what the product should feel like; this one records what was decided, what was rejected, and what may not be re-opened. Where both speak, they agree; if they ever don't, the more specific rule here wins and `design-direction.md` needs correcting.

**Meta-rule everything else follows from:**

> Screenshot colour is not ground truth; `globals.css` is.
> Where a token already exists with a recorded rationale, keep the existing value and adopt only the role.

A design review conducted from screenshots can see symptoms, not the system. It contributes a **role structure and a defect list** — never values. When a review's value conflicts with an authored token, the token wins and the review is wrong.

Corollary, learned the hard way: **an assertion about what does *not* exist in the codebase is a question, not an instruction.** A list of off-token usages is not evidence that tokens are absent.

---

## Standing rules

These hold until deliberately revisited. Each has a guard or a test where one is practical.

### Colour
- No off-token colour in components. Exempt by nature: `color-contrast.ts` (functional), `email.ts` (mail clients cannot resolve custom properties), `brand_color` fallbacks (user data). Exempt as **debt, not on the merits**: `lib/pdf/shared.tsx`, `lib/pdf/quote-pdf.tsx`, `lib/pdf/sow-pdf.tsx` — those three come off the list when the PDF is rebuilt. The authoritative list is `EXEMPT` in `tests/regression/no-off-token-colour.test.ts`, and it may only ever shrink.
- The rule targets palette-scale classes (`bg-red-50`), arbitrary values (`bg-[#abc]`) and hex literals. Tailwind's `text-white` / `bg-black` are **not** currently covered by the guard and are not being swept; `--accent-foreground` exists if a token form is wanted later.
- `#004225` British Racing Green is the brand. It is in the native binary, in `themeColor`, and is every contractor's `brand_color` default. **Do not re-value it.**
- **Amber means "your move"** — the contractor owes an action. Draft is amber. Awaiting payment is neutral and deliberately quiet.
  Rationale: the user is scanning for *what do I have to do*, not *what am I waiting on*. Attention belongs on the actionable. This retired the blue Sent/Viewed badges and it has now survived a second challenge.
- Use `--amber` for marks — dots, keylines, icons — and `--amber-ink` for anything that has to be read. `--amber` on `--amber-tint` is 4.18:1 and fails AA for body text; `--amber-ink` is 5.91:1 there.
- Red is a contained panel, never loose coloured text.
- No `dark:` variants. Tailwind v4 emits them under `prefers-color-scheme` with no opt-in, so with no dark theme any `dark:` variant is an unreviewed second theme shipping to users with the OS setting on. Guarded, on both the class form and a bare `@media (prefers-color-scheme)` block.

### Type
- Body ≥ 14.5px · labels and metadata ≥ 13px · nothing below 12px on screen · **≥ 12pt in print**.
- The label tier is `--text-xs`. Raise the floor at the token, never at the call sites — the utility name is unchanged, so 172 usages move at once.
- No italics outside parsed content. `contracts/markdown.ts` parses `*italic*` out of contract text and is exempt — that is content markup, not styling.
- Money is `tabular-nums` and right-aligned.

### Contrast
- Body text ≥ 4.5:1. Headline-scale ≥ 3:1.
- A pending or disabled control loses its label *colour*, not its *contrast*. White on a washed fill is the failure mode to watch for.
- **Never dim with `opacity`.** It composites the fill *and* the label toward what is behind them, so both ends move together and the ratio collapses — it looks like dimming and is erasure. A disabled control states its own fill and ink (`--muted-fill` / `--muted-ink`, 7.54:1). Guarded.

### Surface
- `p-4`, radius 11, 1px border. Not up for renegotiation — sub-5px geometry differences are invisible and changing shared primitives to chase them moves every screen for nothing.
- **No cards nested inside cards.** Internal groups separate with a 1px rule.
- Cards carry no resting shadow. `shadow-hover` stays. The `--shadow-*` tokens are pinned by the #119 contract and are not to be retired for tidiness.
  **Not yet applied:** `components/ui/card.tsx` still carries `shadow-resting`, and `address-autocomplete.tsx` / `cost-form.tsx` carry `shadow-elevated` / `shadow-lg`. The ruling was made but never scheduled into a numbered step. See Remaining scope.

### Controls
- `h-11` (44px) is the global floor. **Closed decision: no 52px variant.** If a sticky action bar is ever built, its single primary action goes to 52px and nothing else does.
- One primary action per screen. Not currently guarded — there is no check that counts primaries per screen, so this is a review rule rather than an enforced one.

### Structure
- **Say it once — deduplicate the telling, never the doing.** Repeating a status in a banner, a chip and a card is noise. Removing a card that carries the screen's controls is a different and worse mistake. Strip announcement chrome; keep action surfaces.
- Errors are contained panels adjacent to what failed, stating (a) what happened in plain words, (b) what it means for the user's money, (c) the route out.
- Chip and timeline both derive from the single `deriveSituation` call. They must not be able to disagree.

### Layout
- Every screen root pads for `env(safe-area-inset-*)` — **including transient roots** (`loading.tsx`, `error.tsx`, `not-found.tsx`). A skeleton that collides with the clock does so on every navigation, not once.
- Reach for `--safe-top`, never `env()` directly. It is the one place that decision lives. Guarded.
- Exceptions, held deliberately and tracked as defect lists that may only shrink (`every-screen-carries-the-top-inset.test.ts`):
  - the four customer-document pages — `c/[id]`, `i/[id]`, `i/[id]/paid`, `q/[id]` — deferred on 9 Sep because each carries the control the customer came to press, and moving four live customer surfaces wants a device walk;
  - their three loading skeletons, which move *with* their pages. Insetting a skeleton whose page is not inset trades a static collision for a ~62px jump on every navigation, which is worse.
- Centred overlays are exempt by construction — content pinned mid-viewport has no top edge. A root is checked only when it renders its own `<main>` or `<header>`.
- Native shell config (`capacitor.config.ts`, `themeColor`) is not touched for design reasons. It requires a new binary.

---

## Mechanism notes

- The safe-area mechanism has been wrongly "fixed" twice on a confident-but-wrong premise. Do not touch `AppHeader` / `PageHeader` while `top-bar-safe-area.test.tsx` pins their strings verbatim.
- A frozen assertion may be retired when it pinned a **proxy** rather than the intent — e.g. asserting a colour class as a stand-in for component identity. Conditions: name the specific lines, land the corrected assertion in the same commit, and assert the real intent rather than loosening the check.
- New guards are verified to fail before being committed.
- The acceptance-test freeze is enforced by CI **only on `factory/` branches** — `acceptance-test-immutability` and `spec-immutability` are gated on `startsWith(github.head_ref, 'factory/')`. On any other branch the freeze rests on convention and review. Worth knowing before relying on CI to catch an unauthorised edit.

---

## Withdrawn — do not re-assert

These were proposed and rejected with reasons. If they resurface, the answer is already no.

| Proposed | Ruling |
|---|---|
| Re-value `--ground` `--ink` `--green` `--border` | Keep today's values |
| Amber = "waiting"; draft neutral, awaiting-payment amber | Reversed — amber is "your move" |
| Delete every `box-shadow` | Tokens stay; no resting shadow on cards only |
| Nothing below 15px | Body stays 14.5px |
| 52px button floor | 44px stays; no variant |
| Card 20px padding / radius 10 | `p-4` / radius 11 stays |
| Delete the green banner | Keep — it carries the `delivered=0` copy-link fallback |
| Delete the NEXT-STEP card | Keep — it is the job page's action surface |
| Delete "Update price" | Keep — it is the fixed-price entry path, not a save button |
| Auto-save on blur in the quote editor | The `dirty`-aborts-send guard outranks it. Show dirty state instead |
| Change `theme-color` / Capacitor config | Don't touch |
| Mint new amber/red token sets | They already exist — 98 live usages |

---

## Open

- **Auto-expanding the bank-transfer fallback** after one failed card attempt. Customer-facing payment behaviour; awaiting sign-off.
- **"Multiplier"** — label change only, pending. Keep the persisted field; `quote-math.ts` and `quote-learning.ts` untouched. Suggested: `Markup`, helper text `1.2 = 20% on top`. Expressing it as a true percentage changes stored semantics and needs a migration.

## Settled since the handoff

- **Payment error copy** — approved 11 Sep and shipped in #704. The failure panel is contained, sits above the button, and leads with "Nothing has been charged." The retry clause is conditional: dropped for the above-ceiling case, where pressing the button again cannot succeed. The `revealTransfer` error-clear shipped alongside it.

## Remaining scope

1. ~~Off-token colour~~
2. ~~Transient roots~~
3. ~~Contrast and italics sweep; sign-in's two alternative links differentiated by role~~
4. ~~Announcement chrome on the job page~~
5. **Quote PDF** — largest remaining item. Runs a separate navy system (`#111827` / `#6b7280` / `#e5e7eb` / `#f9fafb`); it is the only artefact the customer keeps. Ref and date printed twice, two different footers, `fontSize: 8` italic captions. *Note: the empty `CUSTOMER` heading and the missing Subtotal/VAT were already fixed on `main` before this work started — `quote-pdf.tsx` guards the heading on `hasCustomer` and renders Subtotal/VAT.* Decide the 12pt floor before starting: current sizes run 7.5–9.5pt, so it is a ~1.3–1.6× rescale of the whole document and will reflow pages.
6. Quote editor legibility — Multiplier label, the redundant `Assumed —` prefix, visible dirty state
7. Voice capture — halo clearance, label below the circle, live level meter from real amplitude, `prefers-reduced-motion` fallback, delete the unlabelled input, anchor and left-align the explainer
8. Device journey walk — the four customer-document pages, the three held skeletons, the green band below the web view (almost certainly native `backgroundColor` under `contentInset: "never"`, not a DOM element)
9. Cards carry no resting shadow — ruled but never scheduled. Three call sites: `card.tsx`, `address-autocomplete.tsx`, `cost-form.tsx`
