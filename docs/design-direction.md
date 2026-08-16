# motko — Design Direction

The taste document. Where this is specific, follow it exactly. It records both
the brief that governed the restyle session and the decisions taken in it, so
that factory specs can cite a rule rather than re-litigate it.

**Status:** established in the hand-run restyle session on `main` @ `da66d18`.
Reference screens: the contractor dashboard (`/dashboard`) and the customer
payment page (`/i/[id]`). Everything else in the product inherits the tokens
and is restyled against those two screens.

---

## 1. Subject, audience, job

**Subject:** motko — voice-first quoting, contracts and payment for UK
tradespeople. A money tool, not admin software.

**Audience:** sole-trader and small-firm tradespeople. They price jobs at
kitchen tables and in vans. They are professionals who take pride in the finish
of their work and judge tools the same way. They did not choose a desk job.

**The design's single job:** make the state of your money legible in one
glance, and make every document a customer sees look like it came from a
serious outfit.

**The enemy:** "the desk" — form-heavy software built by people who have never
held a tool. The design must not look like desk software.

**Where the language comes from:** the trade's own paperwork and kit, elevated.
Job sheets, duplicate invoice books, van signwriting, the stamped-and-dated
authority of documents that mean money. The feel to aim at is *the
best-organised tradesperson you've ever met*.

Explicitly NOT: fintech gradient-glass, startup pastel, dashboard-widget
clutter, cream-paper-and-serif, or undecided grey-on-white.

---

## 2. Palette — final values

Every value is an opaque literal in `src/app/globals.css`. Text tiers are
opaque hexes, not alphas, so contrast is deterministic on both the paper ground
and a white card.

| Role | Token | Value | Rule |
|---|---|---|---|
| ink | `--ink` | `#1A2B23` | All primary text. Never pure `#000`. |
| ink, secondary | `--ink-secondary` | `#4B5851` | Supporting copy, eyebrows, meta. 6.90:1 on ground. |
| ink, muted | `--ink-muted` | `#657069` | **The floor.** 4.77:1 on ground — anything lighter fails AA for normal text. |
| ground | `--ground` | `#F7F6F2` | App canvas. Cool paper, deliberately not warm cream. |
| card | `--card` | `#FFFFFF` | Surfaces. |
| card, pressed | `--card-hover` | `#F2F1EC` | Hover **and** press fill. |
| green | `--green` | `#004225` | Brand, primary actions, paid/positive. |
| green, pressed | `--green-hover` | `#00351E` | |
| green tint | `--green-tint` | `#E3E8E2` | Positive chips. |
| amber | `--amber` | `#B45309` | ONE job: "your move". Never decoration. |
| amber tint | `--amber-tint` | `#F2E9DF` | |
| red | `--red` | `#B91C1C` | Declined, expired, errors. Hue-separated from amber. |
| red tint | `--red-tint` | `#F6E7E4` | |
| line | `--line` | `#E4E2DB` | Hairline **inside** a card. |
| line, strong | `--line-strong` | `#D6D3CA` | Card border **on** the ground. |

### Decisions taken in session

- **Green is `#004225`, not `#14532D`.** The brief listed `#14532D` as "the
  existing motko green, kept" — it isn't; the shipped green is `#004225`. Kept
  what ships: it is deeper, higher contrast (white on it is 11.63:1 vs 9.11:1),
  and it is already in every sent PDF, every email, the iOS splash and
  `themeColor`. Changing it would have drifted every document customers already
  hold.
- **`line` needed splitting in two.** A single hairline cannot serve both
  surfaces: `#E4E2DB` on the paper ground is 1.20:1 — effectively invisible.
  Card borders on the ground use `--line-strong`; dividers inside a white card
  use `--line`.
- **A red was added.** The brief's palette has no error colour, but declined,
  expired and overdue states exist and the quality floor requires them to be
  legible. `#B91C1C` is retained from the shipped palette and is hue-separated
  from amber so the two never read as the same signal.

### Rules

- **State is colour.** Paid/positive is green, your-move is amber, waiting on a
  customer is neutral, declined is red. There are no grey "everything" badges.
- **Amber never appears unless the contractor owes an action.** Nothing else in
  the product may use it.
- **`info` resolves to a neutral.** The old blue "Sent"/"Viewed" badges are
  gone: waiting on a customer is not a state the contractor should be pulled
  towards.
- **No new colours may be introduced downstream.** The factory rollout inherits
  exactly these roles.

---

## 3. Type

**One family, two roles: Archivo**, a variable grotesque with a width axis.
Wired via `next/font/google` in `src/app/layout.tsx` with `axes: ["wdth"]` —
the width axis must be requested explicitly or `font-variation-settings` on it
silently no-ops.

- **Body / UI** — Archivo at `wdth 100`. Quiet, high-legibility. Sentence case
  everywhere.
- **Display / money** — Archivo at `wdth 112` via the `.display` utility.
  Money figures, page titles, the ledger figure, the trade's own name.

### Why Archivo, chosen by eye against Bricolage Grotesque and Zilla Slab

- It holds at 47px and reads signwritten rather than typeset.
- Its figures are near-tabular by default (5.59px spread across digits, vs
  Bricolage's 187.84), which matters in a product that is mostly columns of
  money.
- Bricolage was rejected: the `£` collides with the following digit at row
  size, which is disqualifying for a money-first product.
- Zilla Slab was rejected: the `1` is narrow and flared, the figures read
  editorial rather than authoritative, and it is static (two files, no width
  axis).
- `wdth 125` (full Expanded) was tried and overflows a 390px canvas at four
  digits plus pence. **112 is the maximum that fits the primary canvas.**

### THE MONEY RULE (non-negotiable)

> Every monetary amount in the product renders in the display face with tabular
> numerals. Money is never set in body type again.

Enforced by `src/components/ui/money.tsx`. **Always render money through
`<Money>`** rather than calling `formatGBP` into a bare `<span>` — that is what
keeps the rule true as screens get added. Three sizes: `row` (list rows and
body lines), `total`, `hero` (the one big figure a screen is built around).

### Scale

Tuned in place — the Tailwind utility **names** are unchanged, so every screen
outside the session's scope inherits the new rhythm without an edit. The old
16 / 18 / 19.2 / 20px pile-up is gone; there is now one step per decision.

| Utility | px | Used for |
|---|---|---|
| `text-xs` | 12.5 | Eyebrows, meta, hints |
| `text-sm` | 14.5 | Body and UI default |
| `text-base` | 16 | Emphasis body |
| `text-lg` | 19 | Card titles, section headings |
| `text-xl` | 22 | |
| `text-2xl` | 26 | Page titles |
| `text-3xl` | 32 | |
| `text-4xl` | 40 | Payment page "amount due" |
| `text-5xl` | 47 | The ledger figure. Nothing is larger. |

Weights: 400 body, 600 semibold, 700 for display and money. No 800+.

**The eyebrow** (`.eyebrow`): 12.5px, 600, `0.09em` tracking, uppercase, set in
`--ink-secondary`. It does real structural work and is never dropped to a
lighter grey — the previous 12px muted grey sat below AA.

---

## 4. The signature: the ledger figure

The one element motko is remembered by. On the dashboard, the amount that
matters — outstanding, or owed to you — set large in the display face on the
paper ground, with the plain-language label beneath it in the product's voice.
Everything else on the screen stays quiet around it.

- It is the largest thing in the product. **"Your work" is the `h1` for
  structure but is set as an eyebrow** so nothing competes with the figure.
- The customer payment page uses the same treatment for "Amount due" — that is
  the money moment, and it gets the same weight.
- Zero state is `You're all square`, in the display face, with a supporting
  line. Not an empty figure.

### Terminal-state stamp — VERDICT: ruled chip, no rotation

Tried at three levels and judged by eye. The **ruled chip** ships: ruled box,
tracked caps, display face, single colour (`.stamp`). It carries the
stamped-document authority without the novelty.

**The −1.4° rotation was cut.** It holds at row size but reads as a sticker
rather than a stamp at large sizes. Restraint beat the gimmick. Do not
reintroduce rotation, texture, or a second stamp colour.

Applied to `Paid` and `Signed` only — the two states that mean the job is
finished and the money is settled.

---

## 5. Structure and motion

- **Hierarchy by state, not sameness.** "Your move" items carry a 3px amber
  keyline down the leading edge (`.keyline-move`); "waiting" items do not;
  history is quieter still (a ruled list, no cards). The
  identical-cards-for-everything pattern is over.
  - The keyline is a **pseudo-element, not a left border**. A `border-l-amber`
    utility loses to the element's own `border-color` shorthand because
    Tailwind emits the shorthand after the longhand. Use `.keyline-move`.
- **Empty states are invitations, not dashed voids.** Same voice as the copy:
  "Quotes you've sent will sit here until they're viewed or accepted."
  **No dashed borders anywhere in the product.** Left-aligned — centred text in
  a dashed box reads as an error.
- **Motion:** one orchestrated moment, the ledger figure settling on load —
  `.animate-ledger`, a 280ms rise-and-fade (`--dur-settle`). Not a count-up:
  what you are owed is a fact, not a fruit machine. Nothing else is ambient.
  Reduced motion is respected (verified: duration collapses to 0.01ms).
- **Press states everywhere.** Every interactive element carries an `active:`
  treatment as well as `hover:`. On touch there is no hover, so a hover-only
  colour change is not feedback — it just sticks after the tap.
- **Density:** lists are denser (`py-3`, `gap-2` between rows); the space is
  spent on the ledger figure and the money column.
- **Whole rows are tap targets.** `PipelineRow` stretches the name link over
  the row with `after:absolute after:inset-0`, so the target is the full row
  (350×99 measured) rather than the ~22px of the name. The action slot sits at
  `z-10` so it stays independently tappable without nesting anchors.

---

## 6. Voice

The existing register is the brand and is protected: "You're all square",
"Your move", "We never hold your money." Verbs on buttons — "Send quote", never
"Submit". If a new string sounds like software, rewrite it until it sounds like
a good foreman.

**Legally signed-off strings are restyled, never rewritten, and never
relocated.** The reassurance strip's copy says payments are processed by
Stripe; it therefore appears only on the pay-by-bank branch, never on the
manual bank-transfer branch where it would be false.

---

## 7. Quality floor (mandatory, unannounced)

Verified in-session at 320 / 390 / 1280px on both reference screens:

| Requirement | Status |
|---|---|
| Responsive to 320px | ✅ 0px horizontal overflow on both screens at all three widths |
| Contrast ≥ WCAG AA on all text, including on green | ✅ every pair computed; muted tier pinned at the 4.5:1 floor |
| Visible keyboard focus | ✅ 2px solid `--green`, 2px offset — now including `<summary>`, which previously matched no focus selector |
| Reduced motion respected | ✅ `--dur-settle` → 0.01ms |
| Touch targets ≥44px | ✅ only exception is links inside a sentence, which WCAG exempts |
| No regression to shipped loading / skeleton / press-state work | ✅ full suite green, 1070 tests |

**In-prose links** use `<InlineLink inProse>`, which drops the 44px box. A
44px-tall link inside a paragraph stretches the line and breaks its rhythm;
WCAG's target-size rule exempts links in a block of text.

---

## 8. What the factory inherits

1. **Tokens** — `src/app/globals.css`. Colour roles, type scale, radii,
   elevation, motion. These **replace** the previous values; legacy semantic
   aliases are mapped onto the new roles so unreviewed screens re-skin for free.
2. **Reference screens** — `/dashboard` and `/i/[id]`. Restyle everything else
   against these.
3. **Primitives** — `Money`, `StatusChip`, `PipelineRow`, `Card`, `EmptyState`,
   `ErrorState`, `InlineLink`, `Button`, `.display`, `.eyebrow`,
   `.keyline-move`, `.stamp`.

### Constraints discovered in session that specs must respect

- **`--shadow-*`, `--ease-*` and `--dur-*` values are pinned by the frozen
  acceptance test for issue #119.** They may be added to but not retuned.
  `--dur-settle` was added because `--dur-slow` (360ms) overruns the brief's
  300ms cap on the one orchestrated moment.
- **`DashboardHero` is bound by the frozen test for issue #133**: the amount's
  wrapping `div` must carry `text-4xl` and `tabular-nums`, and the greeting must
  render alongside it.
- **`ReassuranceStrip` is bound by the frozen test for issue #152**: no
  `text-xs` and no `text-muted` on any descendant, the shield must remain a
  sibling of the first copy line, and the company name must stay in a
  `font-medium`/`semibold`/`bold` element.
- **`Button`'s success class name must contain the string `success`** (frozen
  test for #118 asserts on the class name).
- `CountUp` (`src/components/ui/count-up.tsx`) is no longer used by the hero but
  is retained because its own tests import it directly. It is a removal
  candidate, not a live component.

---

## 9. Follow-on surfaces — factory card stubs

One line each, to be queued by Jacob. Each is restyleable against the reference
screens without further taste input.

- **Job page (`/jobs/[id]`)** — apply the ledger treatment to the quote total,
  `.keyline-move` to the "Next step" card when the move is the contractor's,
  retire the bespoke move-pill in favour of `StatusChip`, and replace the three
  inline copies of the chip class string.
- **Quote editor (`src/app/jobs/[id]/quote-editor.tsx`)** — `<Money>` for every
  amount and line total; the borderless hover-only description field needs a
  visible affordance on touch; the two `rounded-lg` panels move to `rounded-card`.
- **Customer quote view (`/q/[id]`)** — same document treatment as the payment
  page: `<Money>` for line totals and the grand total, brand colour demoted to
  the monogram, `.display` company name.
- **Contract page (`/c/[id]`)** — document treatment; `ContractBody` heading
  scale onto the new type scale; deposit/balance block gets the ledger figure.
- **Jobs history (`/jobs`)** — filter chips onto the new chip treatment (they
  are currently ~30px tall and fail the tap floor), totals band onto `<Money>`,
  `PipelineRow` gains `yourMove` for in-progress jobs.
- **Settings + Setup** — section cards, the section-eyebrow class (43 inline
  copies of the same string across the product), and `Select` needs the error
  and hint slots the other form primitives already have.
- **App chrome / nav at 390px** — the header nav wraps to two rows on the
  primary canvas, pushing the ledger figure down. Needs a considered mobile
  treatment; out of scope for this session.
- **Emails** — inherit the palette and the money rule; Archivo will not load in
  most clients, so specify the fallback stack explicitly.
- **PDF templates (`src/lib/pdf/**`)** — same tokens, same money rule; requires
  Archivo registered with `@react-pdf/renderer`. Separate card, deliberately not
  touched here.
- **Component consolidation** — `Badge` and `StatusChip` have byte-identical
  class strings; `CopyLinkButton` and `CopyValueButton` are duplicate
  implementations; the control class string is triplicated. See
  `docs/design-inventory.md` §8.

---

## 10. Out of scope for the session that set this

No new features, no flow changes, no copy rewrites beyond empty states and
buttons on the two reference screens. No factory cards created — stubs only. No
changes to PDF generation. No dark mode; decide after the light direction
settles.
