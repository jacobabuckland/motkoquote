# Motko — front-end design inventory

**Auditing `claude/design-inventory-pkoz0j` @ `da66d18`** (identical tree to `origin/main` @ `da66d18`; no working-tree changes). Generated 2026-08-15.

This is an inventory only. Nothing in the codebase was modified. Where a value could not be determined statically it is recorded as `unknown` rather than estimated.

Raw data: [`docs/design-inventory.json`](./design-inventory.json).

---

## Scope

### Directories scanned — 85 files

| Directory | What it holds |
|---|---|
| `src/app/**` | Product routes, the root layout, error boundaries, `loading.tsx` skeletons |
| `src/components/**` | Shared UI primitives (`ui/`), native shims, voice UI |

Only `.tsx` and `.css` files were scanned. The complete file list is in the JSON under `meta.files`.

### Excluded — and why

| Excluded | Reason |
|---|---|
| `src/app/(marketing)/**` | Marketing pages — the landing page, its 8 private components, `marketing.css`, `opengraph-image.tsx`. **This is a substantial second design system that this report deliberately does not cover.** |
| `src/lib/pdf/**` | Generated PDF templates (`@react-pdf/renderer`) — quote, contract, SoW, shared |
| `src/lib/email.ts`, `src/lib/contracts/templates.ts` | Transactional email bodies and contract-document markdown |
| `src/app/api/**` | Route handlers — no rendered UI |
| `tests/**`, `*.test.ts(x)`, `src/checks/**` | Test code |
| `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/.well-known/**` | Non-visual |
| `native/`, `ios/`, `public/`, `fixtures/`, `scripts/`, `supabase/` | Not front-end source |

`/privacy` and `/support` **are** included: they sit outside the marketing route group, are reachable from inside the app, and are required by the App Store listing.

---

## 1. Visual tokens in use

The design system is declared in `src/app/globals.css` (`:root` + `@theme inline`). Values below are reported as written; the resolved literal is given alongside where the token chain terminates in one. Per the brief, `#FFF`, `#ffffff` and `white` are **not** merged.

### 1.1 Colour — literal values

Every hex / `rgb()` / `rgba()` / `color-mix()` / `currentColor` written out in full. Almost all live in `globals.css` as token definitions; the exceptions are called out in §1.4 and §1.5.

| Value | Count | Top files (occurrences) | Note |
|---|---|---|---|
| `#004225` | 9 | `src/app/globals.css` (2)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/layout.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1) |  |
| `currentColor` | 5 | `src/components/ui/button.tsx` (3)<br>`src/components/ui/reassurance-strip.tsx` (1)<br>`src/components/voice/mic-permission-screen.tsx` (1) |  |
| `#ffffff` | 3 | `src/app/globals.css` (3) |  |
| `#222222` | 2 | `src/app/globals.css` (2) |  |
| `#f7f7f7` | 2 | `src/app/globals.css` (2) |  |
| `rgba(0, 66, 37, 0.06)` | 2 | `src/app/globals.css` (2) |  |
| `rgba(0, 66, 37, 0.08)` | 2 | `src/app/globals.css` (2) |  |
| `rgba(0, 66, 37, 0.10)` | 2 | `src/app/globals.css` (2) |  |
| `#00351e` | 1 | `src/app/globals.css` (1) |  |
| `#15803d` | 1 | `src/app/globals.css` (1) |  |
| `#1d4ed8` | 1 | `src/app/globals.css` (1) |  |
| `#717171` | 1 | `src/app/globals.css` (1) |  |
| `#949494` | 1 | `src/app/globals.css` (1) |  |
| `#b45309` | 1 | `src/app/globals.css` (1) |  |
| `#b91c1c` | 1 | `src/app/globals.css` (1) |  |
| `#dddddd` | 1 | `src/app/globals.css` (1) |  |
| `#e6efea` | 1 | `src/app/globals.css` (1) |  |
| `#eff6ff` | 1 | `src/app/globals.css` (1) |  |
| `#f0fdf4` | 1 | `src/app/globals.css` (1) |  |
| `#fef2f2` | 1 | `src/app/globals.css` (1) |  |
| `#FF385C` | 1 | `src/app/globals.css` (1) | **COMMENT ONLY — named in the globals.css header comment as the Airbnb Rausch red this design replaces. Never rendered.** |
| `#fffbeb` | 1 | `src/app/globals.css` (1) |  |
| `color-mix(in srgb, var(--color-primary)` | 1 | `src/app/globals.css` (1) | **full value: color-mix(in srgb, var(--color-primary) 20%, transparent) — the input :focus ring** |
| `rgba(0, 66, 37, 0.04)` | 1 | `src/app/globals.css` (1) |  |
| `rgba(0, 66, 37, 0.05)` | 1 | `src/app/globals.css` (1) |  |
| `rgba(0, 66, 37, 0.07)` | 1 | `src/app/globals.css` (1) |  |
| `rgba(0, 66, 37, 0.14)` | 1 | `src/app/globals.css` (1) |  |
| `rgba(0,66,37,0.45)` | 1 | `src/app/jobs/new/page.tsx` (1) |  |

> `#418` in `src/app/layout.tsx:24` was excluded — it is the React error code "#418" inside a comment, not a colour.

### 1.2 Colour — CSS custom properties

Every `var(--…)` reference, all of which are in `globals.css` (no component reads a custom property directly).

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `--color-primary` | #004225 | 5 | `src/app/globals.css` (5) |
| `--background` | #ffffff | 3 | `src/app/globals.css` (3) |
| `--border` | #dddddd | 3 | `src/app/globals.css` (3) |
| `--radius-sm` | — | 3 | `src/app/globals.css` (3) |
| `--text-primary` | #222222 | 3 | `src/app/globals.css` (3) |
| `--color-primary-hover` | #00351e | 2 | `src/app/globals.css` (2) |
| `--color-secondary-text` | #717171 | 2 | `src/app/globals.css` (2) |
| `--radius-md` | — | 2 | `src/app/globals.css` (2) |
| `--shadow-hover` | — | 2 | `src/app/globals.css` (2) |
| `--shadow-resting` | — | 2 | `src/app/globals.css` (2) |
| `--success` | #15803d | 2 | `src/app/globals.css` (2) |
| `--surface` | #ffffff | 2 | `src/app/globals.css` (2) |
| `--text-muted` | #949494 | 2 | `src/app/globals.css` (2) |
| `--accent` | #004225 | 1 | `src/app/globals.css` (1) |
| `--accent-foreground` | #ffffff | 1 | `src/app/globals.css` (1) |
| `--accent-hover` | #00351e | 1 | `src/app/globals.css` (1) |
| `--color-background` | #ffffff | 1 | `src/app/globals.css` (1) |
| `--color-border` | #dddddd | 1 | `src/app/globals.css` (1) |
| `--color-foreground` | #222222 | 1 | `src/app/globals.css` (1) |
| `--color-primary-light` | #e6efea | 1 | `src/app/globals.css` (1) |
| `--color-star` | #222222 | 1 | `src/app/globals.css` (1) |
| `--color-surface` | #f7f7f7 | 1 | `src/app/globals.css` (1) |
| `--ease-spring` | — | 1 | `src/app/globals.css` (1) |
| `--error` | #b91c1c | 1 | `src/app/globals.css` (1) |
| `--error-bg` | #fef2f2 | 1 | `src/app/globals.css` (1) |
| `--font-inter` | — | 1 | `src/app/globals.css` (1) |
| `--font-sans` | — | 1 | `src/app/globals.css` (1) |
| `--info` | #1d4ed8 | 1 | `src/app/globals.css` (1) |
| `--info-bg` | #eff6ff | 1 | `src/app/globals.css` (1) |
| `--radius-card` | — | 1 | `src/app/globals.css` (1) |
| `--radius-control` | — | 1 | `src/app/globals.css` (1) |
| `--radius-pill` | — | 1 | `src/app/globals.css` (1) |
| `--shadow-1` | — | 1 | `src/app/globals.css` (1) |
| `--shadow-2` | — | 1 | `src/app/globals.css` (1) |
| `--shadow-raised` | — | 1 | `src/app/globals.css` (1) |
| `--success-bg` | #f0fdf4 | 1 | `src/app/globals.css` (1) |
| `--surface-hover` | #f7f7f7 | 1 | `src/app/globals.css` (1) |
| `--text-secondary` | #717171 | 1 | `src/app/globals.css` (1) |
| `--warning` | #b45309 | 1 | `src/app/globals.css` (1) |
| `--warning-bg` | #fffbeb | 1 | `src/app/globals.css` (1) |


### 1.3 Colour — Tailwind utilities, resolved

Each utility resolved through `@theme inline` to its literal. Two utilities resolve to **nothing** — flagged in bold.

| Value | Resolved value | Count | Top files (occurrences) | Note |
|---|---|---|---|---|
| `text-text-secondary` | #717171 | 162 | `src/app/jobs/[id]/page.tsx` (31)<br>`src/app/setup/setup-form.tsx` (19)<br>`src/app/setup/voice/page.tsx` (14)<br>`src/app/jobs/[id]/quote-editor.tsx` (11)<br>`src/app/jobs/new/page.tsx` (8) |  |
| `border-border` | #dddddd | 63 | `src/app/setup/setup-form.tsx` (8)<br>`src/app/c/[id]/contract-body.tsx` (4)<br>`src/app/dashboard/create-contract-form.tsx` (4)<br>`src/app/jobs/[id]/quote-editor.tsx` (4)<br>`src/app/jobs/page.tsx` (3) |  |
| `text-error` | #b91c1c | 40 | `src/app/jobs/[id]/quote-editor.tsx` (5)<br>`src/app/settings/fee-billing-section.tsx` (3)<br>`src/app/setup/setup-form.tsx` (3)<br>`src/app/dashboard/create-contract-form.tsx` (2)<br>`src/app/jobs/new/page.tsx` (2) |  |
| `text-text-muted` | #949494 | 31 | `src/app/setup/setup-form.tsx` (6)<br>`src/app/dashboard/create-contract-form.tsx` (4)<br>`src/app/jobs/[id]/quote-editor.tsx` (4)<br>`src/components/ui/pipeline-stepper.tsx` (3)<br>`src/components/ui/logo-upload.tsx` (2) |  |
| `bg-surface` | #ffffff | 27 | `src/app/setup/setup-form.tsx` (5)<br>`src/app/dashboard/create-contract-form.tsx` (3)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (3)<br>`src/app/jobs/new/page.tsx` (2)<br>`src/app/jobs/page.tsx` (2) |  |
| `text-foreground` | #222222 | 25 | `src/app/c/[id]/contract-body.tsx` (3)<br>`src/app/setup/setup-form.tsx` (3)<br>`src/app/dashboard/create-contract-form.tsx` (2)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (2)<br>`src/app/global-error.tsx` (1) |  |
| `text-secondary-text` | #717171 | 25 | `src/app/dashboard/page.tsx` (8)<br>`src/app/jobs/page.tsx` (5)<br>`src/app/motko/page.tsx` (3)<br>`src/components/ui/pipeline-row.tsx` (2)<br>`src/app/dashboard/archive-quote-button.tsx` (1) |  |
| `text-primary` | #004225 | 20 | `src/app/dashboard/page.tsx` (4)<br>`src/components/ui/pipeline-stepper.tsx` (3)<br>`src/app/privacy/page.tsx` (2)<br>`src/app/support/page.tsx` (2)<br>`src/app/globals.css` (1) |  |
| `text-success` | #15803d | 14 | `src/app/jobs/[id]/page.tsx` (3)<br>`src/app/dashboard/create-invoice-form.tsx` (2)<br>`src/app/c/[id]/contract-response.tsx` (1)<br>`src/app/dashboard/create-contract-form.tsx` (1)<br>`src/app/q/[id]/quote-response.tsx` (1) |  |
| `text-warning` | #b45309 | 13 | `src/app/jobs/[id]/quote-editor.tsx` (5)<br>`src/app/dashboard/page.tsx` (2)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/badge.tsx` (1) |  |
| `bg-surface-hover` | #f7f7f7 | 9 | `src/app/c/[id]/contract-body.tsx` (1)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/new/page.tsx` (1) |  |
| `border-error` | #b91c1c | 8 | `src/app/settings/delete-account.tsx` (2)<br>`src/app/dashboard/create-contract-form.tsx` (1)<br>`src/app/jobs/[id]/quote-editor.tsx` (1)<br>`src/components/ui/address-autocomplete.tsx` (1)<br>`src/components/ui/input.tsx` (1) |  |
| `text-accent` | #004225 | 8 | `src/app/jobs/new/page.tsx` (3)<br>`src/app/setup/voice/page.tsx` (2)<br>`src/app/login/page.tsx` (1)<br>`src/app/signup/page.tsx` (1)<br>`src/components/voice/mic-permission-screen.tsx` (1) |  |
| `bg-accent` | #004225 | 7 | `src/app/jobs/new/page.tsx` (5)<br>`src/app/global-error.tsx` (1)<br>`src/app/setup/voice/page.tsx` (1) |  |
| `bg-warning-bg` | #fffbeb | 7 | `src/app/dashboard/page.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/badge.tsx` (1)<br>`src/components/ui/fee-runway-banner.tsx` (1) |  |
| `bg-error-bg` | #fef2f2 | 5 | `src/app/dashboard/create-contract-form.tsx` (1)<br>`src/app/jobs/[id]/quote-editor.tsx` (1)<br>`src/components/ui/badge.tsx` (1)<br>`src/components/ui/fee-runway-banner.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |  |
| `bg-success-bg` | #f0fdf4 | 5 | `src/app/jobs/[id]/page.tsx` (2)<br>`src/app/c/[id]/contract-response.tsx` (1)<br>`src/components/ui/badge.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |  |
| `border-warning` | #b45309 | 5 | `src/app/jobs/[id]/quote-editor.tsx` (2)<br>`src/app/dashboard/page.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1) |  |
| `bg-primary` | #004225 | 4 | `src/components/ui/pipeline-stepper.tsx` (2)<br>`src/components/ui/activity-timeline.tsx` (1)<br>`src/components/ui/button.tsx` (1) |  |
| `border-primary` | #004225 | 4 | `src/components/ui/pipeline-stepper.tsx` (2)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/app/jobs/page.tsx` (1) |  |
| `divide-border` | #dddddd | 4 | `src/app/q/[id]/loading.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1)<br>`src/app/setup/setup-form.tsx` (1)<br>`src/components/ui/address-autocomplete.tsx` (1) |  |
| `text-accent-foreground` | #ffffff | 4 | `src/app/jobs/new/page.tsx` (2)<br>`src/app/global-error.tsx` (1)<br>`src/app/setup/voice/page.tsx` (1) |  |
| `text-white` | #fff (Tailwind `white`) | 4 | `src/components/ui/pipeline-stepper.tsx` (2)<br>`src/components/ui/button.tsx` (1)<br>`src/components/ui/toast.tsx` (1) |  |
| `bg-accent/50` | #004225 @ 50% opacity | 3 | `src/app/jobs/new/page.tsx` (2)<br>`src/app/setup/voice/page.tsx` (1) |  |
| `bg-primary-light` | #e6efea | 3 | `src/app/dashboard/page.tsx` (1)<br>`src/app/i/[id]/paid/page.tsx` (1)<br>`src/app/jobs/page.tsx` (1) |  |
| `bg-accent/15` | #004225 @ 15% opacity | 2 | `src/app/jobs/new/page.tsx` (1)<br>`src/components/voice/mic-permission-screen.tsx` (1) |  |
| `bg-background` | #ffffff | 2 | `src/app/global-error.tsx` (1)<br>`src/app/layout.tsx` (1) |  |
| `bg-error` | #b91c1c | 2 | `src/app/settings/delete-account.tsx` (1)<br>`src/components/ui/pipeline-stepper.tsx` (1) |  |
| `bg-info-bg` | #eff6ff | 2 | `src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |  |
| `bg-transparent` | transparent | 2 | `src/app/jobs/[id]/quote-editor.tsx` (1)<br>`src/app/setup/setup-form.tsx` (1) |  |
| `bg-warning/5` | #b45309 @ 5% opacity | 2 | `src/app/jobs/[id]/quote-editor.tsx` (2) |  |
| `border-success` | #15803d | 2 | `src/app/c/[id]/contract-response.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1) |  |
| `text-info` | #1d4ed8 | 2 | `src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |  |
| `text-text-primary` | #222222 | 2 | `src/components/ui/reassurance-strip.tsx` (2) | **BROKEN — resolves to --color-text-primary, which globals.css never defines. Tailwind emits no rule; the element keeps the inherited colour.** |
| `accent-primary` | #004225 | 1 | `src/components/ui/checkbox.tsx` (1) |  |
| `bg-black/40` | #000 (Tailwind `black`) @ 40% opacity | 1 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1) |  |
| `bg-error/10` | #b91c1c @ 10% opacity | 1 | `src/components/voice/mic-permission-screen.tsx` (1) |  |
| `bg-foreground` | #222222 | 1 | `src/components/ui/toast.tsx` (1) |  |
| `bg-primary/10` | #004225 @ 10% opacity | 1 | `src/components/ui/pipeline-stepper.tsx` (1) |  |
| `bg-primary/5` | #004225 @ 5% opacity | 1 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1) |  |
| `bg-stone-200` | #e7e5e4 (Tailwind default palette) | 1 | `src/components/ui/skeleton.tsx` (1) | **Tailwind default palette. The ONLY stock-palette colour in the product UI.** |
| `bg-surface-secondary` | unknown (not a project token) | 1 | `src/components/ui/reassurance-strip.tsx` (1) | **BROKEN — resolves to --color-surface-secondary, which globals.css never defines. Tailwind emits no rule; the card renders with no fill.** |
| `border-accent` | #004225 | 1 | `src/app/jobs/new/page.tsx` (1) |  |
| `border-error/40` | #b91c1c @ 40% opacity | 1 | `src/components/ui/fee-runway-banner.tsx` (1) |  |
| `border-t-transparent` | unknown (not a project token) | 1 | `src/app/jobs/new/page.tsx` (1) |  |
| `border-transparent` | transparent | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |  |
| `border-warning/40` | #b45309 @ 40% opacity | 1 | `src/components/ui/fee-runway-banner.tsx` (1) |  |
| `ring-accent/40` | #004225 @ 40% opacity | 1 | `src/app/setup/voice/page.tsx` (1) |  |
| `ring-primary/20` | #004225 @ 20% opacity | 1 | `src/components/ui/pipeline-stepper.tsx` (1) |  |


### 1.4 Colour — Tailwind arbitrary values ⚠

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `shadow-[0_0_28px_rgba(0,66,37,0.45)]` | 0_0_28px_rgba(0,66,37,0.45) | 1 | `src/app/jobs/new/page.tsx` (1) |

One arbitrary colour in the whole product UI: the listening-orb glow on the voice-intake screen. `rgba(0,66,37,0.45)` is `--color-primary` at 45% alpha, hard-coded rather than expressed as `primary/45`.

### 1.5 Colour — inline `style` attributes ⚠

Nine `style={{…}}` blocks across the product UI. Four carry visual values:

| Value | Count | Top files (occurrences) |
|---|---|---|
| `color: brandColor` | 3 | `src/app/c/[id]/page.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1) |
| `maxHeight: "200px", overflowY: "auto"` | 2 | `src/app/jobs/new/page.tsx` (2) |
| `color: textColor` | 1 | `src/components/ui/monogram.tsx` (1) |
| `paddingTop: "max(0.5rem, env(safe-area-inset-top))"` | 1 | `src/components/ui/offline-banner.tsx` (1) |


| File:line | What it sets | Why it is inline |
|---|---|---|
| `src/components/ui/monogram.tsx:22`, `:49` | `width`, `height`, `backgroundColor`, `fontSize` | Runtime-sized avatar from a `size` prop and a contractor-chosen brand colour |
| `src/components/ui/monogram.tsx:57` | `color: textColor` | Contrast colour computed at runtime by `getContrastingTextColor` |
| `src/app/c/[id]/page.tsx:99`, `src/app/i/[id]/page.tsx:103`, `src/app/q/[id]/page.tsx:96` | `color: brandColor` | Contractor brand colour on the customer-facing document heading |
| `src/app/jobs/new/page.tsx:1161`, `:1205` | `maxHeight: "200px"`, `overflowY: "auto"` | **Not runtime-dependent — a static value that should be a utility class.** The only genuinely avoidable inline style. |
| `src/app/jobs/new/page.tsx:1285` | `transform: scale(…)` from live mic level | Runtime audio level |
| `src/components/ui/offline-banner.tsx:30` | `paddingTop: "max(0.5rem, env(safe-area-inset-top))"` | `env()` inside `max()` — no equivalent utility; `.pt-safe` exists in `globals.css` but has no `max()` floor |

The contractor brand colour is the one truly dynamic colour in the app. It is **not** validated against the design system anywhere — `setup-form.tsx:902` is a raw `<input type="color">`, so any hex is accepted.

### 1.6 Font sizes

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `text-sm` | 14px / 0.875rem (lh 1.25rem) | 212 | `src/app/jobs/[id]/page.tsx` (24)<br>`src/app/jobs/[id]/quote-editor.tsx` (14)<br>`src/app/setup/setup-form.tsx` (13)<br>`src/app/setup/voice/page.tsx` (13)<br>`src/app/jobs/new/page.tsx` (11) |
| `text-xs` | 12px / 0.75rem (lh 1rem) | 119 | `src/app/setup/setup-form.tsx` (20)<br>`src/app/jobs/[id]/page.tsx` (15)<br>`src/app/jobs/[id]/quote-editor.tsx` (14)<br>`src/app/dashboard/page.tsx` (8)<br>`src/app/dashboard/create-contract-form.tsx` (5) |
| `text-lg` | 18px / 1.125rem (lh 1.75rem) | 31 | `src/app/privacy/page.tsx` (8)<br>`src/app/dashboard/page.tsx` (3)<br>`src/app/jobs/page.tsx` (3)<br>`src/app/motko/page.tsx` (2)<br>`src/app/settings/fees-statement-section.tsx` (2) |
| `text-2xl` | 24px / 1.5rem (lh 2rem) | 24 | `src/app/c/[id]/page.tsx` (2)<br>`src/app/jobs/[id]/page.tsx` (2)<br>`src/app/jobs/[id]/quote-editor.tsx` (2)<br>`src/app/q/[id]/page.tsx` (2)<br>`src/app/auth/confirm/page.tsx` (1) |
| `text-base` | 16px / 1rem (lh 1.5rem) | 5 | `src/app/jobs/[id]/page.tsx` (2)<br>`src/app/c/[id]/contract-body.tsx` (1)<br>`src/app/jobs/new/page.tsx` (1)<br>`src/components/voice/mic-permission-screen.tsx` (1) |
| `text-3xl` | 30px / 1.875rem (lh 2.25rem) | 1 | `src/app/i/[id]/page.tsx` (1) |
| `text-4xl` | 36px / 2.25rem (lh 2.5rem) | 1 | `src/components/ui/dashboard-hero.tsx` (1) |
| `text-xl` | 20px / 1.25rem (lh 1.75rem) | 1 | `src/app/i/[id]/paid/page.tsx` (1) |


**Arbitrary font sizes:** none.

**CSS-declared:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `16px` | 1 | `src/app/globals.css` (1) |


**Inline:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `size * 0.4` | 1 | `src/components/ui/monogram.tsx` (1) |

`Monogram` computes `fontSize: size * 0.4`. At the default `size = 48` that is **19.2px** — a ninth size that appears nowhere in the scale.

### 1.7 Font weights

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `font-medium` | 500 | 124 | `src/app/jobs/[id]/page.tsx` (18)<br>`src/app/setup/voice/page.tsx` (14)<br>`src/app/dashboard/page.tsx` (13)<br>`src/app/jobs/[id]/quote-editor.tsx` (13)<br>`src/app/setup/setup-form.tsx` (13) |
| `font-semibold` | 600 | 79 | `src/app/privacy/page.tsx` (9)<br>`src/app/c/[id]/contract-body.tsx` (4)<br>`src/app/dashboard/page.tsx` (4)<br>`src/app/jobs/[id]/page.tsx` (4)<br>`src/app/jobs/[id]/quote-editor.tsx` (4) |
| `font-normal` | 400 | 2 | `src/app/setup/setup-form.tsx` (1)<br>`src/components/ui/logo-upload.tsx` (1) |


Three weights only, and `font-normal` is used twice purely to *undo* an inherited `font-medium` on a label. Effectively a two-weight system (500 / 600) with no 400 body weight and no 700 anywhere. SVG `strokeWidth` (a separate visual weight axis) uses three values:

| Value | Count | Top files (occurrences) |
|---|---|---|
| `2` | 3 | `src/components/ui/button.tsx` (1)<br>`src/components/ui/monogram.tsx` (1)<br>`src/components/ui/reassurance-strip.tsx` (1) |
| `1.8` | 1 | `src/components/voice/mic-permission-screen.tsx` (1) |
| `4` | 1 | `src/components/ui/button.tsx` (1) |


### 1.8 Line heights

| Value | Count | Top files (occurrences) |
|---|---|---|
| `leading-relaxed` | 2 | `src/app/privacy/page.tsx` (1)<br>`src/app/support/page.tsx` (1) |


**CSS-declared:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `1.4` | 1 | `src/app/globals.css` (1) |


Only two explicit line-height decisions exist in the entire product UI: `body { line-height: 1.4 }` and `leading-relaxed` (1.625) on the two legal-copy pages. Everything else inherits Tailwind's per-size default line-height, which means the *effective* leading changes with every `text-*` class and was never chosen deliberately. **No arbitrary line-height values.**

### 1.9 Letter spacing

| Value | Count | Top files (occurrences) |
|---|---|---|
| `tracking-wide` | 43 | `src/app/jobs/[id]/page.tsx` (13)<br>`src/app/setup/setup-form.tsx` (8)<br>`src/app/dashboard/page.tsx` (7)<br>`src/app/jobs/[id]/quote-editor.tsx` (5)<br>`src/app/jobs/page.tsx` (4) |
| `tracking-wider` | 1 | `src/app/settings/referral-section.tsx` (1) |


**CSS-declared:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `-0.02em` | 1 | `src/app/globals.css` (1) |


`tracking-wide` appears 43 times and is always paired with `text-xs uppercase` on a section eyebrow — a single de facto component (see §3.12) copy-pasted 43 times.

### 1.10 Spacing (margin / padding / gap)

66 distinct spacing utilities. The 4px base grid is respected everywhere except `gap-1.5`/`mt-0.5`/`py-0.5`/`px-2.5`/`mt-1.5`/`py-1.5`/`gap-0.5` (2px and 6px and 10px steps).

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `gap-3` | 12px | 107 | `src/app/setup/setup-form.tsx` (13)<br>`src/app/dashboard/page.tsx` (11)<br>`src/app/jobs/[id]/page.tsx` (9)<br>`src/app/dashboard/create-contract-form.tsx` (5)<br>`src/app/jobs/[id]/quote-editor.tsx` (5) |
| `gap-2` | 8px | 84 | `src/app/jobs/[id]/page.tsx` (15)<br>`src/app/jobs/[id]/quote-editor.tsx` (11)<br>`src/app/setup/voice/page.tsx` (7)<br>`src/app/setup/setup-form.tsx` (6)<br>`src/app/dashboard/create-contract-form.tsx` (5) |
| `gap-1` | 4px | 36 | `src/app/jobs/[id]/quote-editor.tsx` (9)<br>`src/app/jobs/[id]/page.tsx` (4)<br>`src/app/jobs/loading.tsx` (3)<br>`src/app/jobs/new/page.tsx` (3)<br>`src/app/setup/voice/page.tsx` (3) |
| `p-6` | 24px | 35 | `src/app/auth/confirm/page.tsx` (2)<br>`src/app/jobs/new/page.tsx` (2)<br>`src/app/setup/voice/page.tsx` (2)<br>`src/app/auth/error/page.tsx` (1)<br>`src/app/c/[id]/loading.tsx` (1) |
| `gap-4` | 16px | 28 | `src/app/q/[id]/loading.tsx` (3)<br>`src/app/dashboard/loading.tsx` (2)<br>`src/app/dashboard/page.tsx` (2)<br>`src/app/jobs/new/page.tsx` (2)<br>`src/app/login/page.tsx` (2) |
| `gap-6` | 24px | 23 | `src/app/jobs/new/page.tsx` (3)<br>`src/app/setup/voice/page.tsx` (3)<br>`src/app/jobs/new/loading.tsx` (2)<br>`src/app/setup/voice/loading.tsx` (2)<br>`src/app/c/[id]/loading.tsx` (1) |
| `gap-1.5` | 6px | 16 | `src/app/setup/setup-form.tsx` (4)<br>`src/app/dashboard/create-contract-form.tsx` (3)<br>`src/components/ui/address-autocomplete.tsx` (2)<br>`src/app/dashboard/page.tsx` (1)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1) |
| `mb-1` | 4px | 16 | `src/app/settings/delete-account.tsx` (2)<br>`src/app/settings/settings-client.tsx` (2)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1) |
| `mt-1` | 4px | 16 | `src/app/c/[id]/page.tsx` (2)<br>`src/app/jobs/[id]/page.tsx` (2)<br>`src/app/c/[id]/contract-body.tsx` (1)<br>`src/app/c/[id]/contract-response.tsx` (1)<br>`src/app/c/[id]/loading.tsx` (1) |
| `mx-auto` | auto | 16 | `src/app/dashboard/loading.tsx` (2)<br>`src/app/jobs/[id]/loading.tsx` (2)<br>`src/app/jobs/loading.tsx` (2)<br>`src/app/motko/loading.tsx` (2)<br>`src/app/dashboard/page.tsx` (1) |
| `px-3` | 12px | 15 | `src/app/setup/setup-form.tsx` (4)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (2)<br>`src/app/jobs/page.tsx` (2)<br>`src/components/ui/address-autocomplete.tsx` (2)<br>`src/app/dashboard/create-contract-form.tsx` (1) |
| `p-3` | 12px | 13 | `src/app/dashboard/create-contract-form.tsx` (3)<br>`src/app/jobs/new/page.tsx` (2)<br>`src/app/setup/setup-form.tsx` (2)<br>`src/app/c/[id]/contract-response.tsx` (1)<br>`src/app/dashboard/page.tsx` (1) |
| `px-4` | 16px | 13 | `src/app/q/[id]/loading.tsx` (3)<br>`src/app/jobs/[id]/quote-editor.tsx` (2)<br>`src/components/ui/button.tsx` (2)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/global-error.tsx` (1) |
| `px-6` | 24px | 11 | `src/app/dashboard/loading.tsx` (1)<br>`src/app/jobs/[id]/loading.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/new/loading.tsx` (1)<br>`src/app/motko/loading.tsx` (1) |
| `py-4` | 16px | 11 | `src/app/dashboard/loading.tsx` (1)<br>`src/app/jobs/[id]/loading.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/new/loading.tsx` (1)<br>`src/app/motko/loading.tsx` (1) |
| `space-y-2` | 8px | 11 | `src/app/privacy/page.tsx` (8)<br>`src/app/support/page.tsx` (3) |
| `mb-3` | 12px | 7 | `src/app/settings/settings-client.tsx` (2)<br>`src/app/settings/fee-billing-section.tsx` (1)<br>`src/app/settings/fees-statement-section.tsx` (1)<br>`src/app/settings/payout-details-section.tsx` (1)<br>`src/app/settings/referral-section.tsx` (1) |
| `py-2` | 8px | 7 | `src/app/i/[id]/bank-transfer-details.tsx` (1)<br>`src/app/setup/setup-form.tsx` (1)<br>`src/components/ui/address-autocomplete.tsx` (1)<br>`src/components/ui/checkbox.tsx` (1)<br>`src/components/ui/offline-banner.tsx` (1) |
| `p-4` | 16px | 6 | `src/app/jobs/[id]/page.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/page.tsx` (1)<br>`src/components/ui/card.tsx` (1)<br>`src/components/ui/pipeline-row.tsx` (1) |
| `py-3` | 12px | 6 | `src/app/q/[id]/loading.tsx` (3)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1)<br>`src/components/ui/fee-runway-banner.tsx` (1) |
| `gap-8` | 32px | 5 | `src/app/dashboard/loading.tsx` (1)<br>`src/app/dashboard/page.tsx` (1)<br>`src/app/motko/loading.tsx` (1)<br>`src/app/motko/page.tsx` (1)<br>`src/app/setup/setup-form.tsx` (1) |
| `mb-6` | 24px | 5 | `src/app/login/page.tsx` (1)<br>`src/app/settings/loading.tsx` (1)<br>`src/app/settings/page.tsx` (1)<br>`src/app/setup/page.tsx` (1)<br>`src/app/signup/page.tsx` (1) |
| `pt-2` | 8px | 5 | `src/app/jobs/[id]/quote-editor.tsx` (3)<br>`src/app/c/[id]/loading.tsx` (1)<br>`src/app/c/[id]/page.tsx` (1) |
| `pt-3` | 12px | 5 | `src/app/jobs/[id]/quote-editor.tsx` (1)<br>`src/app/q/[id]/loading.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1)<br>`src/app/settings/fees-statement-section.tsx` (1)<br>`src/app/settings/referral-section.tsx` (1) |
| `space-y-3` | 12px | 5 | `src/app/settings/delete-account.tsx` (2)<br>`src/app/settings/fees-statement-section.tsx` (2)<br>`src/app/settings/settings-client.tsx` (1) |
| `gap-0.5` | 2px | 4 | `src/app/jobs/[id]/quote-editor.tsx` (2)<br>`src/app/q/[id]/page.tsx` (2) |
| `mb-2` | 8px | 4 | `src/app/jobs/new/page.tsx` (2)<br>`src/app/auth/confirm/page.tsx` (1)<br>`src/app/auth/error/page.tsx` (1) |
| `mt-2` | 8px | 4 | `src/app/c/[id]/contract-body.tsx` (2)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/reassurance-strip.tsx` (1) |
| `px-2.5` | 10px | 4 | `src/app/dashboard/page.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/badge.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |
| `py-0.5` | 2px | 4 | `src/app/dashboard/page.tsx` (1)<br>`src/app/jobs/[id]/page.tsx` (1)<br>`src/components/ui/badge.tsx` (1)<br>`src/components/ui/status-chip.tsx` (1) |
| `gap-y-2` | 8px | 3 | `src/app/dashboard/page.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/page.tsx` (1) |
| `mt-6` | 24px | 3 | `src/app/login/page.tsx` (1)<br>`src/app/signup/page.tsx` (1)<br>`src/components/ui/made-with-motko.tsx` (1) |
| `pl-5` | 20px | 3 | `src/app/c/[id]/contract-body.tsx` (1)<br>`src/app/privacy/page.tsx` (1)<br>`src/app/support/page.tsx` (1) |
| `px-2` | 8px | 3 | `src/app/jobs/[id]/quote-editor.tsx` (2)<br>`src/app/dashboard/create-contract-form.tsx` (1) |
| `space-y-6` | 24px | 3 | `src/app/privacy/page.tsx` (1)<br>`src/app/settings/settings-client.tsx` (1)<br>`src/app/support/page.tsx` (1) |
| `gap-x-6` | 24px | 2 | `src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/page.tsx` (1) |
| `ml-1` | 4px | 2 | `src/app/setup/setup-form.tsx` (2) |
| `mt-0.5` | 2px | 2 | `src/components/ui/checkbox.tsx` (1)<br>`src/components/ui/reassurance-strip.tsx` (1) |
| `mt-3` | 12px | 2 | `src/app/dashboard/create-contract-form.tsx` (1)<br>`src/app/i/[id]/page.tsx` (1) |
| `p-0` | 0px | 2 | `src/app/q/[id]/loading.tsx` (1)<br>`src/app/q/[id]/page.tsx` (1) |
| `p-2` | 8px | 2 | `src/app/c/[id]/contract-body.tsx` (2) |
| `p-8` | 32px | 2 | `src/components/ui/empty-state.tsx` (1)<br>`src/components/ui/error-state.tsx` (1) |
| `pb-safe` | env(safe-area-inset-*) | 2 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/components/ui/toast.tsx` (1) |
| `pl-3` | 12px | 2 | `src/app/c/[id]/contract-body.tsx` (1)<br>`src/app/setup/setup-form.tsx` (1) |
| `py-1` | 4px | 2 | `src/app/jobs/[id]/quote-editor.tsx` (1)<br>`src/app/jobs/page.tsx` (1) |
| `space-y-4` | 16px | 2 | `src/app/settings/fees-statement-section.tsx` (1)<br>`src/app/settings/referral-section.tsx` (1) |
| `space-y-8` | 32px | 2 | `src/app/settings/loading.tsx` (1)<br>`src/app/settings/page.tsx` (1) |
| `-mt-4` | 16px | 1 | `src/app/jobs/new/page.tsx` (1) |
| `gap-5` | 20px | 1 | `src/components/ui/app-header.tsx` (1) |
| `gap-x-3` | 12px | 1 | `src/components/ui/activity-timeline.tsx` (1) |
| `gap-x-4` | 16px | 1 | `src/app/dashboard/page.tsx` (1) |
| `mb-4` | 16px | 1 | `src/app/setup/page.tsx` (1) |
| `ml-2` | 8px | 1 | `src/app/jobs/[id]/page.tsx` (1) |
| `ml-8` | 32px | 1 | `src/components/ui/reassurance-strip.tsx` (1) |
| `ml-auto` | auto | 1 | `src/app/setup/setup-form.tsx` (1) |
| `mt-1.5` | 6px | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |
| `p-1` | 4px | 1 | `src/components/ui/logo-upload.tsx` (1) |
| `p-5` | 20px | 1 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1) |
| `pb-2` | 8px | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |
| `pb-3` | 12px | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |
| `pr-2` | 8px | 1 | `src/app/setup/setup-form.tsx` (1) |
| `pt-4` | 16px | 1 | `src/app/dashboard/page.tsx` (1) |
| `px-1` | 4px | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |
| `px-safe` | env(safe-area-inset-*) | 1 | `src/app/layout.tsx` (1) |
| `py-1.5` | 6px | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |
| `space-y-1` | 4px | 1 | `src/app/privacy/page.tsx` (1) |


**Arbitrary spacing values:** none.

**CSS-declared:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `padding-bottom: env(safe-area-inset-bottom)` | 1 | `src/app/globals.css` (1) |
| `padding-left: env(safe-area-inset-left)` | 1 | `src/app/globals.css` (1) |
| `padding-right: env(safe-area-inset-right)` | 1 | `src/app/globals.css` (1) |
| `padding-top: env(safe-area-inset-top)` | 1 | `src/app/globals.css` (1) |


**Inline:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `paddingTop: "max(0.5rem` | 1 | `src/components/ui/offline-banner.tsx` (1) |


### 1.11 Border radii

| Value | Resolved value | Count | Top files (occurrences) | Note |
|---|---|---|---|---|
| `rounded-control` | 8px (token --radius-control → --radius-sm) | 33 | `src/app/setup/loading.tsx` (6)<br>`src/app/setup/setup-form.tsx` (5)<br>`src/app/jobs/loading.tsx` (3)<br>`src/app/dashboard/create-contract-form.tsx` (2)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (2) |  |
| `rounded-full` | 9999px | 21 | `src/app/jobs/new/page.tsx` (5)<br>`src/components/ui/monogram.tsx` (2)<br>`src/components/ui/pipeline-stepper.tsx` (2)<br>`src/components/voice/mic-permission-screen.tsx` (2)<br>`src/app/dashboard/page.tsx` (1) |  |
| `rounded-card` | 12px (token --radius-card → --radius-md) | 20 | `src/app/dashboard/create-contract-form.tsx` (3)<br>`src/app/jobs/[id]/page.tsx` (2)<br>`src/app/c/[id]/contract-response.tsx` (1)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/dashboard/page.tsx` (1) |  |
| `rounded-md` | 12px (token --radius-md) | 12 | `src/app/i/[id]/paid/page.tsx` (2)<br>`src/app/setup/setup-form.tsx` (2)<br>`src/app/c/[id]/loading.tsx` (1)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/i/[id]/loading.tsx` (1) |  |
| `rounded-lg` | 0.5rem / 8px (Tailwind default — NOT a project token) | 3 | `src/app/jobs/new/page.tsx` (2)<br>`src/components/ui/fee-runway-banner.tsx` (1) | **Tailwind's own --radius-lg (0.5rem = 8px). Not a project token, and numerically identical to rounded-sm / rounded-control.** |
| `rounded-sm` | 8px (token --radius-sm) | 1 | `src/components/ui/button.tsx` (1) |  |
| `rounded-t-2xl` | 1rem / 16px (Tailwind default) | 1 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1) | **Tailwind's own --radius-2xl (1rem = 16px). Not a project token.** |


**Arbitrary radii:** none.

**CSS-declared:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `var(--radius-sm)` | 1 | `src/app/globals.css` (1) |


Seven radius utilities collapse to **four distinct pixel values**: 8px (`rounded-sm`, `rounded-control`, `rounded-lg`), 12px (`rounded-md`, `rounded-card`), 16px (`rounded-t-2xl`), 9999px (`rounded-full`). `--radius-pill: 999px` is defined, exported through `@theme inline`, and **never used** — while `rounded-full` (9999px) does that job 21 times.

### 1.12 Border widths

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `border` | 1px (default) | 48 | `src/app/setup/setup-form.tsx` (8)<br>`src/app/dashboard/create-contract-form.tsx` (5)<br>`src/app/jobs/[id]/quote-editor.tsx` (3)<br>`src/app/jobs/page.tsx` (3)<br>`src/app/c/[id]/contract-body.tsx` (2) |
| `border-b` | 1px (default) | 12 | `src/app/dashboard/loading.tsx` (1)<br>`src/app/i/[id]/bank-transfer-details.tsx` (1)<br>`src/app/jobs/[id]/loading.tsx` (1)<br>`src/app/jobs/loading.tsx` (1)<br>`src/app/jobs/new/loading.tsx` (1) |
| `border-t` | 1px (default) | 11 | `src/app/jobs/[id]/quote-editor.tsx` (4)<br>`src/app/c/[id]/loading.tsx` (1)<br>`src/app/c/[id]/page.tsx` (1)<br>`src/app/dashboard/page.tsx` (1)<br>`src/app/q/[id]/loading.tsx` (1) |
| `border-2` | 2px | 1 | `src/app/jobs/new/page.tsx` (1) |
| `border-l-2` | 2px | 1 | `src/app/c/[id]/contract-body.tsx` (1) |
| `ring-2` | 2px ring | 1 | `src/components/ui/pipeline-stepper.tsx` (1) |
| `ring-4` | 4px ring | 1 | `src/app/setup/voice/page.tsx` (1) |


**Border styles:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `border-dashed` | 3 | `src/components/ui/empty-state.tsx` (1)<br>`src/components/ui/error-state.tsx` (1)<br>`src/components/ui/logo-upload.tsx` (1) |


Two widths in use: 1px (default, 71 occurrences) and 2px (2 occurrences, plus 2 ring widths). `border-l-2` on the contract blockquote and `border-2` on the finish-stage spinner are the only non-hairline borders in the app.

### 1.13 Box shadows

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `shadow-hover` | 0 4px 8px rgba(0,66,37,.08), 0 10px 24px rgba(0,66,37,.10) | 2 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/components/ui/toast.tsx` (1) |
| `focus:shadow-none` | none | 1 | `src/app/setup/setup-form.tsx` (1) |
| `shadow-elevated` | = --shadow-2 = --shadow-hover | 1 | `src/components/ui/address-autocomplete.tsx` (1) |
| `shadow-resting` | 0 1px 2px rgba(0,66,37,.06), 0 2px 6px rgba(0,66,37,.06) | 1 | `src/components/ui/card.tsx` (1) |


**Arbitrary shadows:**
| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `shadow-[0_0_28px_rgba(0,66,37,0.45)]` | 0_0_28px_rgba(0,66,37,0.45) | 1 | `src/app/jobs/new/page.tsx` (1) |


**Token definitions in `globals.css`:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `--shadow-1: var(--shadow-resting)` | 1 | `src/app/globals.css` (1) |
| `--shadow-2: var(--shadow-hover)` | 1 | `src/app/globals.css` (1) |
| `--shadow-card: var(--shadow-1)` | 1 | `src/app/globals.css` (1) |
| `--shadow-elevated: var(--shadow-2)` | 1 | `src/app/globals.css` (1) |
| `--shadow-hairline: 0 1px 1px rgba(0, 66, 37, 0.05), 0 1px 2px rgba(0, 66, 37, 0.04)` | 1 | `src/app/globals.css` (1) |
| `--shadow-hover: 0 4px 8px rgba(0, 66, 37, 0.08), 0 10px 24px rgba(0, 66, 37, 0.10)` | 1 | `src/app/globals.css` (1) |
| `--shadow-hover: var(--shadow-hover)` | 1 | `src/app/globals.css` (1) |
| `--shadow-overlay: 0 8px 16px rgba(0, 66, 37, 0.10), 0 24px 48px rgba(0, 66, 37, 0.14)` | 1 | `src/app/globals.css` (1) |
| `--shadow-raised: 0 2px 4px rgba(0, 66, 37, 0.07), 0 6px 12px rgba(0, 66, 37, 0.08)` | 1 | `src/app/globals.css` (1) |
| `--shadow-raised: var(--shadow-raised)` | 1 | `src/app/globals.css` (1) |
| `--shadow-resting: 0 1px 2px rgba(0, 66, 37, 0.06), 0 2px 6px rgba(0, 66, 37, 0.06)` | 1 | `src/app/globals.css` (1) |
| `--shadow-resting: var(--shadow-resting)` | 1 | `src/app/globals.css` (1) |


Five elevation tokens are defined and five aliases exported. **Only three are ever used** (`shadow-resting` ×1, `shadow-hover` ×2, `shadow-elevated` ×1). `shadow-hairline`, `shadow-raised`, `shadow-overlay` and `shadow-card` are dead. The app is essentially flat: four shadow usages across 85 files.

### 1.14 z-index

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `z-50` | 50 | 3 | `src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/components/ui/offline-banner.tsx` (1)<br>`src/components/ui/toast.tsx` (1) |
| `z-10` | 10 | 1 | `src/components/ui/address-autocomplete.tsx` (1) |


**Arbitrary / CSS z-index:** none.

Two values. `z-50` is shared by three unrelated fixed layers — the offline banner (`sticky top-0`), the toast stack (`fixed bottom-6`) and the mark-as-paid sheet (`fixed inset-0`). **The sheet and the offline banner are on the same stacking level**, so their paint order depends solely on DOM order (the banner is mounted earlier in `layout.tsx`, so the sheet wins). Nothing declares this.

### 1.15 Transition durations

| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `duration-100` | 100ms | 1 | `src/app/jobs/new/page.tsx` (1) |
| `duration-150` | 150ms | 1 | `src/components/ui/button.tsx` (1) |


**Arbitrary durations:**
| Value | Resolved value | Count | Top files (occurrences) |
|---|---|---|---|
| `[animation-duration:1.6s]` | 1.6s | 2 | `src/app/jobs/new/page.tsx` (2) |
| `[animation-delay:0.4s]` | 0.4s | 1 | `src/app/jobs/new/page.tsx` (1) |
| `animate-[toast-in_150ms_ease-out]` | toast-in_150ms_ease-out | 1 | `src/components/ui/toast.tsx` (1) |


**Token definitions in `globals.css`:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `--dur-base: 0.01ms` | 1 | `src/app/globals.css` (1) |
| `--dur-base: 220ms` | 1 | `src/app/globals.css` (1) |
| `--dur-fast: 0.01ms` | 1 | `src/app/globals.css` (1) |
| `--dur-fast: 140ms` | 1 | `src/app/globals.css` (1) |
| `--dur-instant: 0.01ms` | 1 | `src/app/globals.css` (1) |
| `--dur-instant: 80ms` | 1 | `src/app/globals.css` (1) |
| `--dur-slow: 0.01ms` | 1 | `src/app/globals.css` (1) |
| `--dur-slow: 360ms` | 1 | `src/app/globals.css` (1) |
| `--dur-slow: 600ms` | 1 | `src/app/globals.css` (1) |
| `animation-duration: 0.01ms !important` | 1 | `src/app/globals.css` (1) |
| `animation: spin 1s linear infinite` | 1 | `src/app/globals.css` (1) |
| `transition-duration: 0.01ms !important` | 1 | `src/app/globals.css` (1) |
| `transition: background-color 0.3s var(--ease-spring)` | 1 | `src/app/globals.css` (1) |


Four duration tokens are defined (`--dur-instant` 80ms, `--dur-fast` 140ms, `--dur-base` 220ms, `--dur-slow`) and **not one component references any of them.** Every animated thing in the app picks its own number: 150ms (button), 100ms (orb), 150ms (toast keyframe), 300ms (`.button-success`), 600ms (`CountUp`), 1s (spinner), 1.6s (orb ping), 0.4s (ping delay), 300ms (`KeyboardManager` scroll timeout), 3000ms (toast auto-dismiss).

**`--dur-slow` is declared twice** — `globals.css:42` sets `360ms`, then `globals.css:45` re-declares it as `600ms` under a stray second `/* ── Duration ── */` heading. The second wins. Neither value is ever read.

### 1.16 Easing functions

| Value | Count | Top files (occurrences) |
|---|---|---|
| `cubic-bezier(0.34, 1.56, 0.64, 1)` | 2 | `src/app/globals.css` (2) |
| `cubic-bezier(0.16, 1, 0.3, 1)` | 1 | `src/app/globals.css` (1) |
| `cubic-bezier(0.2, 0, 0, 1)` | 1 | `src/app/globals.css` (1) |


**Token definitions in `globals.css`:**
| Value | Count | Top files (occurrences) |
|---|---|---|
| `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` | 2 | `src/app/globals.css` (2) |
| `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` | 1 | `src/app/globals.css` (1) |
| `--ease-standard: cubic-bezier(0.2, 0, 0, 1)` | 1 | `src/app/globals.css` (1) |


Three easing curves defined, **one used** (`--ease-spring` in `.button-success`). `--ease-standard` and `--ease-out` are dead. `--ease-spring` is declared twice (`:root` and again inside `@theme inline`) with the same value. The only other easing in the app is the string `ease-out` inside `animate-[toast-in_150ms_ease-out]`, plus a hand-rolled ease-out-cubic in JS (`count-up.tsx:45`).

### 1.17 State-variant coverage

| Variant | Distinct classes | Total occurrences |
|---|---|---|
| `hover:` | 12 | 40 |
| `active:` | 1 | 1 |
| `focus-visible:` | 3 | 3 |
| `focus:` | 1 | 1 |
| `focus-within:` | 1 | 1 |
| `disabled:` | 2 | 4 |

**`hover:` outnumbers `active:` 40 to 1.** Full breakdown:

| Value | Count | Top files (occurrences) | Note |
|---|---|---|---|
| `hover:text-primary-hover` | 8 | `src/app/dashboard/page.tsx` (3)<br>`src/app/i/[id]/bank-transfer-details.tsx` (1)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/components/ui/copy-link-button.tsx` (1)<br>`src/components/ui/inline-link.tsx` (1) |  |
| `hover:text-foreground` | 7 | `src/components/ui/app-header.tsx` (2)<br>`src/app/jobs/page.tsx` (1)<br>`src/app/setup/page.tsx` (1)<br>`src/app/setup/voice/page.tsx` (1)<br>`src/components/ui/button.tsx` (1) |  |
| `hover:text-accent-hover` | 6 | `src/app/jobs/new/page.tsx` (2)<br>`src/app/setup/voice/page.tsx` (2)<br>`src/app/login/page.tsx` (1)<br>`src/app/signup/page.tsx` (1) |  |
| `hover:underline` | 5 | `src/app/dashboard/page.tsx` (3)<br>`src/app/jobs/[id]/mark-as-paid-button.tsx` (1)<br>`src/components/ui/pipeline-row.tsx` (1) |  |
| `hover:bg-surface-hover` | 4 | `src/components/ui/button.tsx` (2)<br>`src/app/setup/setup-form.tsx` (1)<br>`src/components/ui/address-autocomplete.tsx` (1) |  |
| `hover:text-error` | 3 | `src/app/setup/setup-form.tsx` (2)<br>`src/app/jobs/[id]/quote-editor.tsx` (1) |  |
| `hover:text-primary` | 2 | `src/app/dashboard/archive-quote-button.tsx` (1)<br>`src/components/ui/back-to-dashboard.tsx` (1) |  |
| `hover:bg-primary-hover` | 1 | `src/components/ui/button.tsx` (1) |  |
| `hover:border-border` | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) |  |
| `hover:opacity-90` | 1 | `src/app/settings/delete-account.tsx` (1) |  |
| `hover:text-text-primary` | 1 | `src/app/jobs/[id]/quote-editor.tsx` (1) | **BROKEN — same missing --color-text-primary token.** |
| `hover:text-text-secondary` | 1 | `src/components/ui/made-with-motko.tsx` (1) |  |


| Value | Count | Top files (occurrences) |
|---|---|---|
| `active:scale-[0.98]` | 1 | `src/components/ui/button.tsx` (1) |


| Value | Count | Top files (occurrences) |
|---|---|---|
| `disabled:opacity-50` | 3 | `src/app/dashboard/archive-quote-button.tsx` (1)<br>`src/components/ui/button.tsx` (1)<br>`src/components/voice/mic-permission-screen.tsx` (1) |
| `disabled:pointer-events-none` | 1 | `src/components/ui/button.tsx` (1) |


| Value | Count | Top files (occurrences) |
|---|---|---|
| `focus-visible:outline-2` | 1 | `src/components/ui/button.tsx` (1) |
| `focus-visible:outline-offset-2` | 1 | `src/components/ui/button.tsx` (1) |
| `focus-visible:outline-primary` | 1 | `src/components/ui/button.tsx` (1) |


---

## 2. Interactive element audit

**162 interactive instances** across the product UI: 118 own implementations (a real `<button>`, `<a>`, `<Link>`, `<summary>` or click-handling `<div>`), 43 call sites of a composite component whose treatment is defined once elsewhere, and 2 event-guard divs.

There is **no `role="button"`** anywhere in the product UI — every press target is a real `<button>`, `<a>`, `<summary>` or (twice) a bare `<div onClick>`.

### 2.1 Key to the columns

- **Pressed** — a visible `:active` / pressed treatment.
- **Disabled** — a visible disabled treatment (not merely a disabled attribute).
- **Loading** — a visible in-flight treatment. "text-only" means the label swaps to a "…" string with no spinner.
- **Focus-visible** — `globals.css:221-227` applies `outline: 2px solid var(--color-primary); outline-offset: 2px` to `a:focus-visible`, `button:focus-visible` and `[tabindex]:focus-visible`. Everything matching those three selectors passes for free. `<summary>` matches none of them.
- **Tap area** — height is determinable from `h-11` / `min-h-11`; width is content-driven and recorded as `unknown` unless `w-full` is set.
- **Accessible name** — the computed name. Determinable even through a ternary of string literals.

### 2.2 Own implementations (118)

| # | File:line | Element | Pressed | Disabled | Loading | Focus-visible | Tap area | Accessible name |
|---|---|---|---|---|---|---|---|---|
| 1 | `src/app/auth/confirm/page.tsx:106` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Back to sign in |
| 2 | `src/app/auth/error/page.tsx:12` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Back to sign in |
| 3 | `src/app/c/[id]/contract-response.tsx:95` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Sign contract / Signing… |
| 4 | `src/app/c/[id]/contract-response.tsx:98` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Decline contract / Declining… |
| 5 | `src/app/dashboard/archive-quote-button.tsx:17` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ✅ yes — disabled attr + disabled: styling | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Archive / Archiving… / Try again |
| 6 | `src/app/dashboard/create-contract-form.tsx:307` | <summary> (native disclosure) | ❌ NO | – n/a | ⚠️ no | ❌ NO — globals.css scopes focus-visible to a/button/[tabindex]; <summary> matches none | ❌ NO — no height floor; line-height-sized hit area | Job details for the contract |
| 7 | `src/app/dashboard/create-contract-form.tsx:486` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Yes, send it / Sending… / Try again |
| 8 | `src/app/dashboard/create-contract-form.tsx:489` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Cancel |
| 9 | `src/app/dashboard/create-contract-form.tsx:501` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Send contract |
| 10 | `src/app/dashboard/create-invoice-form.tsx:155` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Send invoice / Sending… |
| 11 | `src/app/dashboard/page.tsx:229` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | N free job(s) left |
| 12 | `src/app/dashboard/page.tsx:237` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | New quote |
| 13 | `src/app/dashboard/page.tsx:249` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | New quote |
| 14 | `src/app/dashboard/page.tsx:305` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | customer name (dynamic), falls back to Customer |
| 15 | `src/app/dashboard/page.tsx:343` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | customer name (dynamic), falls back to Customer |
| 16 | `src/app/dashboard/page.tsx:477` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | customer name (dynamic), falls back to Customer |
| 17 | `src/app/global-error.tsx:27` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Try again |
| 18 | `src/app/i/[id]/bank-transfer-details.tsx:28` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Copy — SAME name on all 3 rows (sort code / account no. / reference); ambiguous out of context |
| 19 | `src/app/i/[id]/page.tsx:135` | <summary> (native disclosure) | ❌ NO | – n/a | ⚠️ no | ❌ NO — globals.css scopes focus-visible to a/button/[tabindex]; <summary> matches none | ❌ NO — no height floor; line-height-sized hit area | Or pay by bank transfer |
| 20 | `src/app/i/[id]/pay-button.tsx:78` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Pay £x by bank / Connecting to your bank… |
| 21 | `src/app/jobs/[id]/mark-as-paid-button.tsx:83` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Mark as paid (compact link variant) |
| 22 | `src/app/jobs/[id]/mark-as-paid-button.tsx:91` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Mark as paid |
| 23 | `src/app/jobs/[id]/mark-as-paid-button.tsx:117` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Cash / Bank transfer / Other |
| 24 | `src/app/jobs/[id]/mark-as-paid-button.tsx:160` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Mark as paid / Marking as paid… |
| 25 | `src/app/jobs/[id]/mark-as-paid-button.tsx:163` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Cancel |
| 26 | `src/app/jobs/[id]/page.tsx:292` | <a> | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Go to the quote |
| 27 | `src/app/jobs/[id]/page.tsx:504` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Call ended before <slots> was/were asked — whole card is one anchor |
| 28 | `src/app/jobs/[id]/page.tsx:672` | <summary> (native disclosure) | ❌ NO | – n/a | ⚠️ no | ❌ NO — globals.css scopes focus-visible to a/button/[tabindex]; <summary> matches none | ❌ NO — no height floor; line-height-sized hit area | Transcript |
| 29 | `src/app/jobs/[id]/quote-editor.tsx:184` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | From the call — check the spelling. Tap to confirm. |
| 30 | `src/app/jobs/[id]/quote-editor.tsx:383` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Retry pricing / Pricing… |
| 31 | `src/app/jobs/[id]/quote-editor.tsx:386` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Build by hand |
| 32 | `src/app/jobs/[id]/quote-editor.tsx:418` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Switch to itemised / Switching… |
| 33 | `src/app/jobs/[id]/quote-editor.tsx:428` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Switch to fixed price / Switching… |
| 34 | `src/app/jobs/[id]/quote-editor.tsx:448` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Update price |
| 35 | `src/app/jobs/[id]/quote-editor.tsx:479` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Remove (line item) |
| 36 | `src/app/jobs/[id]/quote-editor.tsx:489` | <summary> (native disclosure) | ❌ NO | – n/a | ⚠️ no | ❌ NO — globals.css scopes focus-visible to a/button/[tabindex]; <summary> matches none | ❌ NO — no height floor; line-height-sized hit area | Check before sending (n) |
| 37 | `src/app/jobs/[id]/quote-editor.tsx:605` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | + Add line item |
| 38 | `src/app/jobs/[id]/quote-editor.tsx:647` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Save changes / Saving... / Saved / Try again |
| 39 | `src/app/jobs/[id]/quote-editor.tsx:661` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Before you send (n) + Hide/Show |
| 40 | `src/app/jobs/[id]/quote-editor.tsx:679` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Dismiss (flag) |
| 41 | `src/app/jobs/[id]/quote-editor.tsx:763` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Send quote / Sending... / Sent ✓ |
| 42 | `src/app/jobs/[id]/quote-editor.tsx:777` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Check the job page |
| 43 | `src/app/jobs/new/error.tsx:36` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Try again |
| 44 | `src/app/jobs/new/page.tsx:1317` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11), full width — PASS | Finish & price it up |
| 45 | `src/app/jobs/new/page.tsx:1325` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Mute / Unmute |
| 46 | `src/app/jobs/new/page.tsx:1389` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Retry |
| 47 | `src/app/jobs/new/page.tsx:1392` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Save and finish later / Saving… |
| 48 | `src/app/jobs/new/page.tsx:1407` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Try again |
| 49 | `src/app/jobs/page.tsx:116` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | New quote |
| 50 | `src/app/jobs/page.tsx:126` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | filter chip: All / In progress / Completed / Declined / Archived |
| 51 | `src/app/jobs/page.tsx:153` | <button> (one-off inline) | ✅ yes — active:scale-[0.98] (via buttonClass) | ⚠️ not set | ⚠️ no | ✅ yes — focus-visible:outline-2 (via buttonClass) + global rule | ✅ 44px high (h-11 via buttonClass); width content-driven | Search (form submit) |
| 52 | `src/app/jobs/page.tsx:208` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Load more (N more) |
| 53 | `src/app/login/page.tsx:118` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Sign in / Signing in... |
| 54 | `src/app/login/page.tsx:122` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Use an email link instead |
| 55 | `src/app/login/page.tsx:150` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Send sign-in link / Sending... |
| 56 | `src/app/login/page.tsx:154` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Use a password instead |
| 57 | `src/app/login/page.tsx:170` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Create an account |
| 58 | `src/app/motko/page.tsx:49` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | New quote |
| 59 | `src/app/motko/page.tsx:60` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Business details |
| 60 | `src/app/privacy/page.tsx:98` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | support@motko.app (mailto) |
| 61 | `src/app/privacy/page.tsx:109` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | support@motko.app (mailto) |
| 62 | `src/app/q/[id]/quote-response.tsx:48` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Accept quote / Accepting… |
| 63 | `src/app/q/[id]/quote-response.tsx:51` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Decline quote / Declining… |
| 64 | `src/app/settings/delete-account.tsx:31` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Keep my account / Restoring… |
| 65 | `src/app/settings/delete-account.tsx:55` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Cancel |
| 66 | `src/app/settings/delete-account.tsx:62` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Yes, delete my account / Deleting… |
| 67 | `src/app/settings/delete-account.tsx:72` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Delete account |
| 68 | `src/app/settings/fee-billing-section.tsx:53` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Set up fee billing / Connecting to your bank… |
| 69 | `src/app/settings/fee-billing-section.tsx:76` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Re-authorise bank / Connecting to your bank… |
| 70 | `src/app/settings/payout-details-section.tsx:103` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Save bank details / Update bank details / Saving… |
| 71 | `src/app/settings/settings-client.tsx:115` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Enable notifications / Enabling… |
| 72 | `src/app/settings/settings-client.tsx:122` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Send test notification / Sending… |
| 73 | `src/app/settings/stripe-connect-section.tsx:69` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Complete requirements / Connecting to Stripe… |
| 74 | `src/app/settings/stripe-connect-section.tsx:86` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Complete onboarding / Connecting to Stripe… |
| 75 | `src/app/settings/stripe-connect-section.tsx:103` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Connect to Stripe / Connecting to Stripe… |
| 76 | `src/app/setup/page.tsx:66` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Sign out |
| 77 | `src/app/setup/page.tsx:83` | <Link> (next/link → <a>) | ✅ yes — active:scale-[0.98] (via buttonClass) | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css + focus-visible:outline-2 via buttonClass | ✅ 44px high (h-11 via buttonClass); width content-driven | Set up by talking instead |
| 78 | `src/app/setup/setup-form.tsx:495` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Search / Searching… |
| 79 | `src/app/setup/setup-form.tsx:508` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | company title + company number (search result) |
| 80 | `src/app/setup/setup-form.tsx:615` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Remove (team member) |
| 81 | `src/app/setup/setup-form.tsx:650` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | + Add team member |
| 82 | `src/app/setup/setup-form.tsx:680` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Remove (rate card) |
| 83 | `src/app/setup/setup-form.tsx:724` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | + Add rate card |
| 84 | `src/app/setup/setup-form.tsx:925` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Save details / Saving… |
| 85 | `src/app/setup/voice/page.tsx:423` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Sign out |
| 86 | `src/app/setup/voice/page.tsx:542` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Mute / Unmute |
| 87 | `src/app/setup/voice/page.tsx:549` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Done — save my details |
| 88 | `src/app/setup/voice/page.tsx:556` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11); width content-driven | I would rather fill it in manually |
| 89 | `src/app/setup/voice/page.tsx:594` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | Try again |
| 90 | `src/app/setup/voice/page.tsx:601` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11); width content-driven | I would rather fill it in manually |
| 91 | `src/app/signup/page.tsx:125` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Create account / Creating account... |
| 92 | `src/app/signup/page.tsx:134` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Sign in |
| 93 | `src/app/support/page.tsx:26` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | support@motko.app (mailto) |
| 94 | `src/app/support/page.tsx:51` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Privacy Policy |
| 95 | `src/components/ui/address-autocomplete.tsx:203` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | the address suggestion text |
| 96 | `src/components/ui/app-header.tsx:28` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | company name (dynamic) — the brand/home link |
| 97 | `src/components/ui/app-header.tsx:35` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | Speak to Motko / My work / Business / Settings |
| 98 | `src/components/ui/app-header.tsx:50` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ❌ NO — no height floor; text-only control, likely <44px | Sign out |
| 99 | `src/components/ui/back-to-dashboard.tsx:12` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11); width content-driven | Back to dashboard |
| 100 | `src/components/ui/blocked-action.tsx:9` | <button> (one-off inline) | ✅ yes — active:scale-[0.98] (via buttonClass) | ✅ yes — disabled attr + buttonClass disabled:opacity-50 | ⚠️ no | ✅ yes — focus-visible:outline-2 (via buttonClass) + global rule | ✅ 44px high (h-11 via buttonClass); width content-driven | text-xs text-text-muted |
| 101 | `src/components/ui/button.tsx:85` | <button> (one-off inline) | ✅ yes — active:scale-[0.98] (via buttonClass) | ⚠️ not set | ⚠️ no | ✅ yes — focus-visible:outline-2 (via buttonClass) + global rule | ✅ 44px high (h-11 via buttonClass); width content-driven | caller-supplied children (the Button primitive, legacy path) |
| 102 | `src/components/ui/button.tsx:109` | <button> (one-off inline) | ✅ yes — active:scale-[0.98] (via buttonClass) | ⚠️ not set | ⚠️ no | ✅ yes — focus-visible:outline-2 (via buttonClass) + global rule | ✅ 44px high (h-11 via buttonClass); width content-driven | caller-supplied children (the Button primitive, loading/success path) |
| 103 | `src/components/ui/copy-link-button.tsx:21` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ⚠️ not set | ⚠️ no | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | caller-supplied label, defaults to Copy link |
| 104 | `src/components/ui/error-state.tsx:23` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Try again |
| 105 | `src/components/ui/fee-runway-banner.tsx:30` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | ctaLabel from feeRunwayBannerCopy |
| 106 | `src/components/ui/inline-link.tsx:25` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11); width content-driven | caller-supplied children (external anchor branch) |
| 107 | `src/components/ui/inline-link.tsx:31` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11); width content-driven | caller-supplied children (next/link branch) |
| 108 | `src/components/ui/logo-upload.tsx:124` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Upload logo / Replace / Uploading… |
| 109 | `src/components/ui/logo-upload.tsx:133` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11); width content-driven — height PASS, width unknown | Remove |
| 110 | `src/components/ui/made-with-motko.tsx:9` | <a> | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | motko |
| 111 | `src/components/ui/page-header.tsx:23` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | back label, defaults to Back |
| 112 | `src/components/ui/pipeline-row.tsx:32` | <Link> (next/link → <a>) | ❌ NO — no :active state | – n/a (navigation) | ⚠️ no | ✅ yes — global `a:focus-visible` rule in globals.css | ❌ NO — inline text link, no height floor | customer name (dynamic) |
| 113 | `src/components/voice/mic-permission-screen.tsx:63` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11), full width — PASS | caller-supplied startLabel / Starting… |
| 114 | `src/components/voice/mic-permission-screen.tsx:71` | <button> (one-off inline) | ❌ NO — no :active / pressed treatment | ✅ yes — disabled attr + disabled: styling | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — inherited from the global `button:focus-visible` rule in globals.css | ✅ ≥44px high (min-h-11/h-11); width content-driven | caller-supplied manualLabel / Opening… |
| 115 | `src/components/voice/mic-permission-screen.tsx:115` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ no | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11), full width — PASS | Open Settings |
| 116 | `src/components/voice/mic-permission-screen.tsx:123` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ⚠️ available but NOT set on this instance | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11), full width — PASS | Try again |
| 117 | `src/components/voice/mic-permission-screen.tsx:132` | <Button> → <button> (ui/button.tsx) | ✅ yes — active:scale-[0.98] | ✅ yes — disabled prop set; disabled:opacity-50 + pointer-events-none | ⚠️ text-only — label swaps to a '…' string; no spinner | ✅ yes — focus-visible:outline-2 outline-offset-2 outline-primary (+ global a/button rule) | ✅ 44px high (h-11), full width — PASS | caller-supplied manualLabel / Opening… |
| 118 | `src/app/jobs/[id]/mark-as-paid-button.tsx:98` | <div role="dialog" onClick> — sheet backdrop, dismiss-on-tap | ❌ NO — plain div, no :active | ⚠️ guarded in JS (!pending) but NO visual state | ⚠️ no | ❌ NO — not focusable at all (no tabIndex); keyboard users cannot dismiss | ✅ full viewport (fixed inset-0) — PASS by size, but not a real control | "Mark invoice as paid" (aria-label on the dialog, not on the dismiss affordance) |

### 2.3 Composite call sites (43)

These render a component whose entire visual treatment is defined at one place. They inherit whatever that definition provides — see the row for the definition itself in §2.2.

| # | File:line | Component | Definition |
|---|---|---|---|
| 1 | `src/app/c/[id]/page.tsx:79` | `<BackToDashboard>` | `src/components/ui/back-to-dashboard.tsx:11` |
| 2 | `src/app/c/[id]/page.tsx:136` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 3 | `src/app/c/[id]/page.tsx:145` | `<MadeWithMotko>` | `src/components/ui/made-with-motko.tsx:6` |
| 4 | `src/app/dashboard/create-contract-form.tsx:242` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 5 | `src/app/dashboard/create-contract-form.tsx:255` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 6 | `src/app/dashboard/create-contract-form.tsx:256` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 7 | `src/app/dashboard/create-invoice-form.tsx:47` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 8 | `src/app/dashboard/create-invoice-form.tsx:59` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 9 | `src/app/dashboard/create-invoice-form.tsx:71` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 10 | `src/app/dashboard/create-invoice-form.tsx:74` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 11 | `src/app/dashboard/page.tsx:280` | `<ArchiveQuoteButton>` | `src/app/dashboard/archive-quote-button.tsx:10` |
| 12 | `src/app/dashboard/page.tsx:295` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 13 | `src/app/dashboard/page.tsx:394` | `<ArchiveQuoteButton>` | `src/app/dashboard/archive-quote-button.tsx:10` |
| 14 | `src/app/dashboard/page.tsx:418` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 15 | `src/app/dashboard/page.tsx:445` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 16 | `src/app/dashboard/page.tsx:449` | `<MarkAsPaidButton>` | `src/app/jobs/[id]/mark-as-paid-button.tsx:40` |
| 17 | `src/app/dashboard/page.tsx:490` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 18 | `src/app/dashboard/page.tsx:500` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 19 | `src/app/dashboard/page.tsx:501` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 20 | `src/app/dashboard/page.tsx:502` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 21 | `src/app/i/[id]/page.tsx:94` | `<BackToDashboard>` | `src/components/ui/back-to-dashboard.tsx:11` |
| 22 | `src/app/i/[id]/page.tsx:132` | `<PayButton>` | `src/app/i/[id]/pay-button.tsx:7` |
| 23 | `src/app/i/[id]/page.tsx:155` | `<MadeWithMotko>` | `src/components/ui/made-with-motko.tsx:6` |
| 24 | `src/app/i/[id]/paid/page.tsx:81` | `<MadeWithMotko>` | `src/components/ui/made-with-motko.tsx:6` |
| 25 | `src/app/jobs/[id]/page.tsx:296` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 26 | `src/app/jobs/[id]/page.tsx:311` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 27 | `src/app/jobs/[id]/page.tsx:312` | `<BlockedAction>` | `src/components/ui/blocked-action.tsx:7` |
| 28 | `src/app/jobs/[id]/page.tsx:348` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 29 | `src/app/jobs/[id]/page.tsx:349` | `<BlockedAction>` | `src/components/ui/blocked-action.tsx:7` |
| 30 | `src/app/jobs/[id]/page.tsx:380` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 31 | `src/app/jobs/[id]/page.tsx:383` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 32 | `src/app/jobs/[id]/page.tsx:387` | `<MarkAsPaidButton>` | `src/app/jobs/[id]/mark-as-paid-button.tsx:40` |
| 33 | `src/app/jobs/[id]/page.tsx:407` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 34 | `src/app/jobs/[id]/page.tsx:410` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 35 | `src/app/jobs/[id]/page.tsx:414` | `<MarkAsPaidButton>` | `src/app/jobs/[id]/mark-as-paid-button.tsx:40` |
| 36 | `src/app/jobs/[id]/page.tsx:452` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 37 | `src/app/jobs/[id]/page.tsx:527` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 38 | `src/app/jobs/[id]/page.tsx:700` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 39 | `src/app/q/[id]/page.tsx:87` | `<BackToDashboard>` | `src/components/ui/back-to-dashboard.tsx:11` |
| 40 | `src/app/q/[id]/page.tsx:160` | `<InlineLink>` | `src/components/ui/inline-link.tsx:16` |
| 41 | `src/app/q/[id]/page.tsx:175` | `<MadeWithMotko>` | `src/components/ui/made-with-motko.tsx:6` |
| 42 | `src/app/settings/referral-section.tsx:32` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |
| 43 | `src/app/settings/referral-section.tsx:36` | `<CopyLinkButton>` | `src/components/ui/copy-link-button.tsx:7` |

### 2.4 Summary

| Property | Missing | Of | Notes |
|---|---|---|---|
| Distinct pressed / `:active` state | **52** | 118 | The only `:active` treatment in the entire product UI is `active:scale-[0.98]` in `buttonClass`. Every plain `<button>`, every text link, every `<summary>` and the payment-method chips have none. |
| Distinct disabled state | **25** | 118 | Counts controls that either set `disabled` with no visual treatment, or have no disabled path at all. Navigation links are excluded (n/a). |
| Loading state | **83** have none | 118 | 25 of the 83 are navigation links, where loading does not apply. Of the 35 controls that *do* show something in flight, **every single one is a text-only label swap.** `<Button loading>` — the one real spinner path, complete with `aria-busy` — is passed by **no call site in the product UI.** |
| Focus-visible style | **5** | 118 | All 5: the four `<summary>` disclosures and the mark-as-paid sheet backdrop. Everything else is covered by the global `a/button/[tabindex]` rule. |
| ≥44×44pt tap area | **31 fail**, 47 height-only | 118 | 31 controls have no height floor at all. The remainder pass on height (`h-11`/`min-h-11` = 44px) but their **width is content-driven and therefore unknown** — a "Copy" or "Hide" label is well under 44px wide. |
| Accessible name | **1** | 118 | Only the mark-as-paid sheet backdrop (`mark-as-paid-button.tsx:98`), a `<div onClick>` that is not focusable and carries no name of its own. |

**The 31 controls under 44pt:**

- `src/app/dashboard/create-contract-form.tsx:307` — <summary> (native disclosure) — "Job details for the contract"
- `src/app/dashboard/page.tsx:229` — <Link> (next/link → <a>) — "N free job(s) left"
- `src/app/dashboard/page.tsx:305` — <Link> (next/link → <a>) — "customer name (dynamic), falls back to Customer"
- `src/app/dashboard/page.tsx:343` — <Link> (next/link → <a>) — "customer name (dynamic), falls back to Customer"
- `src/app/dashboard/page.tsx:477` — <Link> (next/link → <a>) — "customer name (dynamic), falls back to Customer"
- `src/app/i/[id]/page.tsx:135` — <summary> (native disclosure) — "Or pay by bank transfer"
- `src/app/jobs/[id]/mark-as-paid-button.tsx:83` — <button> (one-off inline) — "Mark as paid (compact link variant)"
- `src/app/jobs/[id]/page.tsx:504` — <a> — "Call ended before <slots> was/were asked — whole card is one anchor"
- `src/app/jobs/[id]/page.tsx:672` — <summary> (native disclosure) — "Transcript"
- `src/app/jobs/[id]/quote-editor.tsx:184` — <button> (one-off inline) — "From the call — check the spelling. Tap to confirm."
- `src/app/jobs/[id]/quote-editor.tsx:489` — <summary> (native disclosure) — "Check before sending (n)"
- `src/app/jobs/[id]/quote-editor.tsx:679` — <button> (one-off inline) — "Dismiss (flag)"
- `src/app/jobs/[id]/quote-editor.tsx:777` — <a> — "Check the job page"
- `src/app/jobs/page.tsx:126` — <Link> (next/link → <a>) — "filter chip: All / In progress / Completed / Declined / Archived"
- `src/app/login/page.tsx:170` — <Link> (next/link → <a>) — "Create an account"
- `src/app/privacy/page.tsx:98` — <a> — "support@motko.app (mailto)"
- `src/app/privacy/page.tsx:109` — <a> — "support@motko.app (mailto)"
- `src/app/setup/page.tsx:66` — <button> (one-off inline) — "Sign out"
- `src/app/setup/setup-form.tsx:615` — <button> (one-off inline) — "Remove (team member)"
- `src/app/setup/setup-form.tsx:680` — <button> (one-off inline) — "Remove (rate card)"
- `src/app/setup/voice/page.tsx:423` — <button> (one-off inline) — "Sign out"
- `src/app/signup/page.tsx:134` — <Link> (next/link → <a>) — "Sign in"
- `src/app/support/page.tsx:26` — <a> — "support@motko.app (mailto)"
- `src/app/support/page.tsx:51` — <a> — "Privacy Policy"
- `src/components/ui/app-header.tsx:28` — <Link> (next/link → <a>) — "company name (dynamic) — the brand/home link"
- `src/components/ui/app-header.tsx:35` — <Link> (next/link → <a>) — "Speak to Motko / My work / Business / Settings"
- `src/components/ui/app-header.tsx:50` — <button> (one-off inline) — "Sign out"
- `src/components/ui/fee-runway-banner.tsx:30` — <Link> (next/link → <a>) — "ctaLabel from feeRunwayBannerCopy"
- `src/components/ui/made-with-motko.tsx:9` — <a> — "motko"
- `src/components/ui/page-header.tsx:23` — <Link> (next/link → <a>) — "back label, defaults to Back"
- `src/components/ui/pipeline-row.tsx:32` — <Link> (next/link → <a>) — "customer name (dynamic)"

**The 5 controls with no focus-visible style:**

- `src/app/dashboard/create-contract-form.tsx:307` — <summary> (native disclosure) — "Job details for the contract"
- `src/app/i/[id]/page.tsx:135` — <summary> (native disclosure) — "Or pay by bank transfer"
- `src/app/jobs/[id]/page.tsx:672` — <summary> (native disclosure) — "Transcript"
- `src/app/jobs/[id]/quote-editor.tsx:489` — <summary> (native disclosure) — "Check before sending (n)"
- `src/app/jobs/[id]/mark-as-paid-button.tsx:98` — <div role="dialog" onClick> — sheet backdrop, dismiss-on-tap — ""Mark invoice as paid" (aria-label on the dialog, not on the dismiss affordance)"

---

## 3. Component reality

Grouped by **what each thing is trying to be**, so the number of parallel implementations is visible. "Times used" counts render sites in the product UI only.

### 3.1 Button-like — the shared primitive

| Component | File | Times used | Visual treatment |
|---|---|---|---|
| `Button` | `src/components/ui/button.tsx:73` | 52 render sites | `inline-flex items-center justify-center gap-2 rounded-sm h-11 text-sm font-semibold transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2` + one of three variants |
| ↳ `variant="primary"` | same | 26 (12 explicit + 14 defaulted) | `bg-primary text-white hover:bg-primary-hover px-4` — solid British Racing Green |
| ↳ `variant="secondary"` | same | 16 | `border border-border bg-surface text-foreground hover:bg-surface-hover px-4` — white, hairline border |
| ↳ `variant="tertiary"` | same | 9 (+1 site that picks the variant at runtime) | `text-secondary-text hover:text-foreground hover:bg-surface-hover px-3` — ghost, grey |
| `buttonClass()` | `src/components/ui/button.tsx:28` | 12 external call sites | The same string exported so `<Link>`, `<a>` and `<button type="submit">` can borrow it |

`Button` also has a `loading` prop that renders a real spinner overlay with `aria-busy` and a `success` prop that renders a tick over a `.button-success` green fill. **No call site in the product UI passes either.** Both code paths are dead.

### 3.2 Button-like — one-off text / ghost actions

Eleven separate treatments for "a press target that looks like text". Every one of these could be `Button variant="tertiary"` or `InlineLink`.

| Implementation | File:line | Used | Visual treatment |
|---|---|---|---|
| `InlineLink` | `src/components/ui/inline-link.tsx:16` | 17 | `inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover` |
| `CopyLinkButton` | `src/components/ui/copy-link-button.tsx:21` | 11 | `inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover` — identical to `InlineLink` **minus the underline** |
| `CopyValueButton` | `src/app/i/[id]/bank-transfer-details.tsx:25` | 3 | **Byte-identical class string to `CopyLinkButton`** — a second, independent copy-to-clipboard button with the same toast behaviour |
| `ArchiveQuoteButton` | `src/app/dashboard/archive-quote-button.tsx:17` | 2 | `inline-flex min-h-11 items-center text-sm font-medium text-secondary-text underline underline-offset-4 hover:text-primary disabled:opacity-50` |
| Mark-as-paid compact | `src/app/jobs/[id]/mark-as-paid-button.tsx:83` | 1 | `text-sm font-medium text-primary hover:text-primary-hover hover:underline` — **no height floor** |
| Accent underline button | `jobs/new/page.tsx:1325`, `:1407`, `setup/voice/page.tsx:542`, `:594` | 4 | `inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover` — uses `accent` where the rest of the app uses `primary` (same colour, different token) |
| Muted underline button | `setup/voice/page.tsx:549`, `mic-permission-screen.tsx:71` | 2 | `inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4` (+`disabled:opacity-50` on one) |
| Muted underline **Link** | `setup/voice/page.tsx:556`, `:601` | 2 | Same class string as above, on a `<Link>` |
| `BackToDashboard` | `src/components/ui/back-to-dashboard.tsx:12` | 3 | `inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-text-secondary hover:text-primary` |
| Sign-out submit | `app-header.tsx:50`, `setup/page.tsx:66`, `setup/voice/page.tsx:423` | 3 | `text-sm text-text-secondary hover:text-foreground` — except `app-header` omits `text-sm`, so the header sign-out renders at 16px while the other two render at 14px |
| Global-error retry | `src/app/global-error.tsx:27` | 1 | `inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground` — a hand-rolled primary button, deliberately not importing `Button` (the boundary must not depend on anything that could fail) |

### 3.3 Button-like — one-off micro actions

| Implementation | File:line | Visual treatment |
|---|---|---|
| Remove (team member / rate card) | `setup-form.tsx:615`, `:680` | `text-xs text-text-secondary hover:text-error` — 12px, no height floor |
| Remove (quote line item) | `quote-editor.tsx:479` | `inline-flex min-h-11 shrink-0 items-center px-1 text-xs font-medium text-text-muted hover:text-error` — same job, different colour token and a height floor |
| Dismiss (contractor flag) | `quote-editor.tsx:679` | `shrink-0 text-xs font-medium text-text-muted hover:text-text-primary` — **`hover:text-text-primary` resolves to nothing** |
| Voice-hint confirm | `quote-editor.tsx:184` | `flex items-center gap-1 self-start text-xs text-warning` — the whole sentence "From the call — check the spelling. Tap to confirm." is the button, with no button affordance at all |
| Flags expander | `quote-editor.tsx:661` | `flex min-h-11 items-center justify-between gap-2 px-4 text-left` + a "Hide"/"Show" text on the right |
| Slow-send fallback link | `quote-editor.tsx:777` | bare `<a className="underline">` |

### 3.4 Button-like — chips and toggles

| Implementation | File:line | Visual treatment |
|---|---|---|
| Payment-method chip | `mark-as-paid-button.tsx:117` | `flex h-11 items-center rounded-control border px-3 text-sm`; selected `border-primary bg-primary/5 font-medium text-foreground`, unselected `border-border bg-surface text-text-secondary`. Uses `aria-pressed` — the only one in the app |
| Job filter chip | `jobs/page.tsx:126` | `rounded-full border px-3 py-1 text-sm`; active `border-primary bg-primary-light font-medium text-primary`, inactive `border-border bg-surface text-secondary-text hover:text-foreground`. **≈30px tall** |
| Free-jobs counter chip | `dashboard/page.tsx:229` | `inline-flex w-fit items-center gap-1 rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary` — visually a `Badge`, functionally a link |
| `StatusChip` | `ui/status-chip.tsx:43` | `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium` + 5 tones. Non-interactive |
| `Badge` | `ui/badge.tsx:12` | **Identical class string to `StatusChip`** with a 4-tone subset. Two components, one treatment |
| Move pill | `jobs/[id]/page.tsx:481` | The `StatusChip`/`Badge` class string written out inline a third time, with a bespoke 3-tone map |

### 3.5 Button-like — full-width picker rows

| Implementation | File:line | Visual treatment |
|---|---|---|
| Address suggestion row | `address-autocomplete.tsx:203` | `flex min-h-11 w-full items-center px-3 py-2 text-left` + active `bg-surface-hover` / `hover:bg-surface-hover` |
| Companies-House result row | `setup-form.tsx:508` | `flex min-h-11 w-full items-center px-3 py-2 text-left hover:bg-surface-hover` — the same row, minus keyboard-active handling |

### 3.6 Link-like — navigation

| Implementation | File:line | Visual treatment |
|---|---|---|
| App nav item | `app-header.tsx:35` | active `font-semibold text-primary`, inactive `text-secondary-text hover:text-foreground`, `aria-current="page"` |
| Brand / home | `app-header.tsx:28` | `text-sm font-semibold` |
| `PageHeader` back | `page-header.tsx:23` | `text-sm text-text-secondary hover:text-foreground`, prefixed with a literal `←` |
| `PipelineRow` customer | `pipeline-row.tsx:32` | `truncate text-sm font-medium text-primary hover:text-primary-hover hover:underline` |
| Dashboard customer (A) | `dashboard/page.tsx:305`, `:343` | `font-medium text-primary hover:text-primary-hover hover:underline` |
| Dashboard customer (B) | `dashboard/page.tsx:477` | `text-sm font-medium text-primary hover:text-primary-hover hover:underline` |
| Auth footer link | `login/page.tsx:170`, `signup/page.tsx:134` | `text-accent hover:text-accent-hover` — no underline, `accent` rather than `primary` |
| Legal mailto | `privacy/page.tsx:98`, `:109`, `support/page.tsx:26`, `:51` | `text-primary underline` |
| Fee-runway CTA | `fee-runway-banner.tsx:30` | `font-semibold underline underline-offset-2` — inherits the banner's tone colour |
| Maker's mark | `made-with-motko.tsx:9` | `underline underline-offset-2 hover:text-text-secondary` |
| Anchor-as-card | `jobs/[id]/page.tsx:504` | An entire warning card wrapped in `<a href="#quote">`; `rounded-card border border-warning bg-warning-bg p-3` |

**Four spellings** of "customer name link to the job" (`PipelineRow`, dashboard A, dashboard B, and the plain `<span>` fallback each of them falls back to).

### 3.7 Input-like

| Component | File | Visual treatment |
|---|---|---|
| `Input` | `ui/input.tsx:9` | Label `text-xs font-medium text-text-secondary` above; field `h-11 rounded-control border bg-surface px-3 text-sm text-foreground`; error swaps `border-border`→`border-error` and appends `text-xs text-error`; hint slot `text-xs text-text-muted` |
| `Textarea` | `ui/textarea.tsx:9` | Same label + error/hint; field `min-h-20 rounded-control border bg-surface px-3 py-2 text-sm text-foreground` |
| `Select` | `ui/select.tsx:7` | Same label; field `h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground`. **No error or hint slot** — the only form primitive that cannot show validation |
| `Checkbox` | `ui/checkbox.tsx:8` | `label` wrapper `flex cursor-pointer items-start gap-3 py-2 text-sm`; box `mt-0.5 h-5 w-5 shrink-0 accent-primary`. Native checkbox, OS-rendered |
| `AddressAutocomplete` | `ui/address-autocomplete.tsx:40` | Replicates `Input`'s label/field/error/hint markup verbatim (+`w-full`) and adds a `role="combobox"` + `role="listbox"` dropdown |
| `LogoUpload` | `ui/logo-upload.tsx:28` | Hidden `<input type="file">` + a 64×64 preview (`h-16 w-16 rounded-control border`) or a dashed placeholder, driven by two `Button`s |

**One-off input implementations:**

| Implementation | File:line | Note |
|---|---|---|
| `controlClass` const | `setup-form.tsx:75` | `h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground` — **byte-identical to `Select`'s class string**, declared locally. The same string also appears verbatim at `mark-as-paid-button.tsx:144` |
| `MoneyInput` | `setup-form.tsx:80` | £-prefix wrapper `flex h-11 items-center rounded-control border border-border bg-surface pl-3 pr-2 focus-within:border-primary` + a bare transparent `<input>`. **The only `focus-within:` in the app**, and the only field whose focus ring differs from `globals.css`'s `input:focus` rule |
| `ConstrainedField` | `setup-form.tsx:113` | Select + "Other…" escape-hatch text input, both using `controlClass` |
| Companies-House search | `setup-form.tsx:488` | `h-11 flex-1 rounded-control border border-border bg-surface px-3 text-sm` — **omits `text-foreground`** |
| Trade discount % | `setup-form.tsx:758` | `h-11 w-16 ... px-3 text-right text-sm tabular-nums` |
| Brand colour picker | `setup-form.tsx:902` | Raw `<input type="color" className="h-11 w-16 cursor-pointer rounded-control border border-border">` — OS colour picker, **no validation against the palette** |
| Job search | `jobs/page.tsx:145` | `h-11 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-foreground` |
| Paid-on date | `mark-as-paid-button.tsx:137` | Hand-rolled label + `<input type="date">` using the duplicated control class |
| Duration amount | `create-contract-form.tsx:391` | `h-11 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-foreground` |
| Duration unit | `create-contract-form.tsx:401` | `h-11 rounded-control border border-border bg-surface px-2 text-sm text-foreground` — **`px-2`, where every other control uses `px-3`** |
| Inline line-item description | `quote-editor.tsx:473` | `flex-1 rounded-control border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-border` — a borderless field that only reveals itself on hover. **No height floor, and hover is the only affordance — invisible on touch** |

### 3.8 Card-like

| Implementation | File | Times used | Visual treatment |
|---|---|---|---|
| `Card` | `ui/card.tsx:3` | 53 (41 in real screens + 12 in loading skeletons) | `rounded-card border border-border bg-surface p-4 shadow-resting` — the only elevated surface in the app |

**Bespoke card treatments (22), none of which use `Card`:**

| File:line | Treatment | Deviates by |
|---|---|---|
| `dashboard/page.tsx:292` | `rounded-card border border-warning bg-warning-bg p-3 text-sm text-warning` | warning tone, `p-3`, no shadow |
| `i/[id]/page.tsx:126` | `rounded-card border border-warning bg-warning-bg p-3 text-sm text-warning` | identical to the above, written out again |
| `jobs/[id]/page.tsx:443` | `flex flex-col gap-2 rounded-card border border-success bg-success-bg p-4` | success tone, no shadow |
| `jobs/[id]/page.tsx:504` | `flex flex-col gap-1 rounded-card border border-warning bg-warning-bg p-3` | warning tone, and it is an `<a>` |
| `c/[id]/page.tsx:81` | `rounded-card border border-border bg-surface px-4 py-3 text-sm` | `px-4 py-3` instead of `p-4`, no shadow |
| `c/[id]/contract-response.tsx:29` | `rounded-card border border-success bg-success-bg p-3` | success tone, `p-3` |
| `create-contract-form.tsx:248` | `rounded-card border border-error bg-error-bg p-3 text-sm` | error tone |
| `create-contract-form.tsx:479` | `rounded-card border border-border bg-surface p-3 text-sm` | `p-3`, no shadow |
| `create-contract-form.tsx:306` | `rounded-card border border-border p-3` | no fill, no shadow, and it is a `<details>` |
| `mark-as-paid-button.tsx:149` | `rounded-card bg-surface-hover p-3 text-sm text-text-secondary` | no border |
| `bank-transfer-details.tsx:70` | `rounded-card border border-border p-3` | no fill |
| `reassurance-strip.tsx:35` | `rounded-card border border-border bg-surface-secondary p-4` | **`bg-surface-secondary` is not a defined token — the card has no fill** |
| `empty-state.tsx:12` | `rounded-card border border-dashed border-border p-8 text-center` | dashed, `p-8` |
| `error-state.tsx:19` | `rounded-card border border-dashed border-border p-8 text-center` | identical to `EmptyState` |
| `jobs/page.tsx:159` | `rounded-card border border-border bg-surface-hover p-4` | grey fill |
| `setup-form.tsx:609`, `:674` | `rounded-md border border-border p-3` | **`rounded-md` not `rounded-card`** (same 12px, different token) |
| `quote-editor.tsx:660` | `rounded-card border border-warning bg-warning/5` | 5%-alpha warning fill — the only alpha fill on a card |
| `quote-editor.tsx:488` | `rounded-control border border-warning bg-warning/5 px-2 py-1.5` | **`rounded-control` (8px)**, a third radius for a card |
| `fee-runway-banner.tsx:27` | `rounded-lg border px-4 py-3 text-sm` | **`rounded-lg` — a Tailwind default, not a project token** |
| `jobs/new/page.tsx:1160`, `:1204` | `rounded-lg border border-border bg-surface p-3 text-sm` | `rounded-lg` again |
| `address-autocomplete.tsx:196` | `rounded-card border border-border bg-surface ... shadow-elevated` | the only `shadow-elevated` in the app |
| `setup-form.tsx:506` | `rounded-card border border-border bg-surface` | no padding (rows self-pad) |
| `i/[id]/paid/page.tsx:59` | `rounded-md bg-primary-light` | logo fallback tile |

### 3.9 List-row-like

| Implementation | File:line | Times used | Visual treatment |
|---|---|---|---|
| `PipelineRow` | `ui/pipeline-row.tsx:20` | 5 render sites (dashboard ×3, jobs history ×1, plus the shared definition) | `flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4` — name + descriptor + `StatusChip` + date on the left, amount + action slot on the right. **`rounded-md` where `Card` uses `rounded-card`** (same 12px) |
| `Card` as a row | `dashboard/page.tsx:475` | 1 | `<Card className="flex items-center justify-between">` — a row with `PipelineRow`'s job but `Card`'s shadow |
| `Row` (bank transfer) | `bank-transfer-details.tsx:45` | 5 | `flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0` |
| Quote line row | `q/[id]/page.tsx:107` | n | `flex justify-between gap-4 px-4 py-3` inside a `divide-y` `Card` with `p-0` |
| `ActivityTimeline` item | `ui/activity-timeline.tsx:17` | n | `flex items-baseline gap-3` + a 8×8 `rounded-full bg-primary` dot |
| `PipelineStepper` item | `ui/pipeline-stepper.tsx:31` | n | 24×24 `rounded-full border` dot with 4 states + label; vertical on mobile, horizontal `sm:` |
| Fee collection row | `fees-statement-section.tsx:88` | n | `flex items-start justify-between gap-3` |
| Referral row | `referral-section.tsx:25`, `:34` | 2 | `flex items-center justify-between gap-3` (+ `border-t pt-3` on the second) |
| Flag row | `quote-editor.tsx:677` | n | `flex items-start justify-between gap-2 text-sm` |
| Assumption row | `jobs/[id]/page.tsx:659` | n | `flex items-baseline justify-between gap-2` |
| Merchant row | `setup-form.tsx:749` | n | `flex items-center gap-3` |

### 3.10 Modal / sheet-like

**One modal exists in the entire product UI.**

| Implementation | File:line | Visual treatment |
|---|---|---|
| Mark-as-paid sheet | `mark-as-paid-button.tsx:96-174` | Backdrop `fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center`; panel `flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-5 pb-safe shadow-hover sm:rounded-2xl`. Bottom-sheet on mobile, centred dialog at `sm:`. Has `role="dialog"` + `aria-modal` + `aria-label`. **No focus trap, no focus restore, no Escape handler, no scroll lock, no enter/exit animation.** |
| `window.confirm()` | `archive-quote-button.tsx:21` | The OS dialog. The only destructive confirmation that is not in-app — inside a WKWebView it renders as an iOS system alert titled with the origin |
| `<details>`/`<summary>` | `create-contract-form.tsx:306`, `i/[id]/page.tsx:134`, `jobs/[id]/page.tsx:671`, `quote-editor.tsx:488` | Native disclosure, no styling of the marker beyond `list-none` on one of the four. No animation |

There is no `Dialog`, `Sheet`, `Drawer` or `Popover` component. The address-autocomplete dropdown (`address-autocomplete.tsx:192`) is the only other overlay and is absolutely positioned at `z-10`.

### 3.11 Toast / banner-like

| Implementation | File:line | Times used | Visual treatment |
|---|---|---|---|
| `ToastProvider` / `useToast` | `ui/toast.tsx:25` | 6 `useToast()` call sites | Container `pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 pb-safe` + `aria-live="polite"`; toast `rounded-md bg-foreground px-4 py-2 text-sm text-white shadow-hover motion-safe:animate-[toast-in_150ms_ease-out]`. Auto-dismisses at 3000ms. **No dismiss control, no variants (success/error/info all look identical), no exit animation** |
| `OfflineBanner` | `ui/offline-banner.tsx:26` | 1 (root) | `sticky top-0 z-50 bg-warning-bg px-4 py-2 text-center text-sm font-medium text-warning` + `role="status"` |
| `FeeRunwayBanner` | `ui/fee-runway-banner.tsx:24` | 1 (dashboard) | `flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm` + error/warning tone + `role="status"` |
| Sent banner | `jobs/[id]/page.tsx:442` | 1 | Success card with a `✓` glyph, title, body and an optional `CopyLinkButton` |
| Autosave status | `setup-form.tsx:928-939` | 1 | Inline `text-xs` in `text-text-muted` / `text-success` / `text-error` — no banner, no toast |
| Section status lines | `stripe-connect-section.tsx:51`, `fee-billing-section.tsx:46`, `payout-details-section.tsx:71` | 3 | `text-sm font-medium text-success` — e.g. "Connected ✓", "Fee billing active", "Ready to receive payments" |

Five parallel ways to say "that worked": a toast, a `?sent=` banner, an inline `text-success` line, a `Saved` micro-label, and a button label swapping to `Sent ✓`.

### 3.12 Other repeated inline patterns

| Pattern | Occurrences | Where |
|---|---|---|
| **Section eyebrow** — `text-xs font-medium uppercase tracking-wide` + a grey | 43 (31 `text-text-secondary`, 11 `text-secondary-text`, 1 `text-warning`) | Written out inline every single time. No `SectionHeading` component exists. Note `setup-form.tsx` and `dashboard/page.tsx` use `text-secondary-text` for the same eyebrow, so there are two spellings of the identical colour |
| **Total row** — `mt-1 flex items-baseline justify-between` + `text-2xl font-semibold tabular-nums` | 4 | `quote-editor.tsx:640`, `q/[id]/page.tsx:150`, `c/[id]/page.tsx:119`, plus the loading skeletons that mirror it |
| **Logo-or-monogram header** — `h-12 w-12 rounded-md object-contain` `<img>` or `<Monogram size={48}>` | 3 | `q/[id]/page.tsx:89`, `c/[id]/page.tsx:92`, `i/[id]/page.tsx:96`. `i/[id]/paid/page.tsx:50` implements a **fourth** variant that falls back to a first-initial tile instead of `Monogram` |
| **`Skeleton`** — `animate-pulse rounded-control bg-stone-200` | 118 instances across 11 `loading.tsx` files | The only use of Tailwind's stock palette anywhere in the product UI |
| **Voice orb** | 2 | `jobs/new/page.tsx:1262` (rings, mic-level scale, `shadow-[0_0_28px_…]`) and `setup/voice/page.tsx:528` (a simpler `ring-4 ring-accent/40` pulse). Two implementations of the same idea |
| **Mic explainer / failure screens** | 1 shared | `components/voice/mic-permission-screen.tsx` — correctly shared by both voice routes |


---

## 4. State coverage gaps

Every async action in the product UI. "Loading" means a visible in-flight treatment; "text-only" means the trigger's label swaps to a "…" string with no spinner. "Empty" is `n/a` where the action has no list-shaped result.

### 4.1 Server actions and mutations

| # | Action | Trigger (file:line) | Loading | Error | Empty | Trigger disabled in flight |
|---|---|---|---|---|---|---|
| 1 | `sendQuote` | `quote-editor.tsx:763` | ⚠️ text-only — "Sending..." → terminal "Sent ✓" | ✅ `text-sm text-error` under the button + a 20s "taking longer than expected" warning | n/a | ✅ `disabled={sent \|\| isSending \|\| blocked}` |
| 2 | `updateQuoteLineItems` | `quote-editor.tsx:647` | ⚠️ text-only — "Saving..." | ✅ label → "Try again" + `text-sm text-error` | n/a | ✅ `disabled={isPending}` |
| 3 | `redraftJob` (retry pricing) | `quote-editor.tsx:383` | ⚠️ text-only — "Pricing…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={retrying}` |
| 4 | `setQuotePricingMode` | `quote-editor.tsx:418`, `:428` | ⚠️ text-only — "Switching…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={switching}` |
| 5 | `setQuotePricingMode` (update fixed price) | `quote-editor.tsx:448` | ❌ **none — label stays "Update price"** | ✅ shares the same `switchError` line | n/a | ✅ `disabled={switching \|\| !(Number > 0)}` |
| 6 | `reportEmptyQuoteDraft` | `quote-editor.tsx:85` (on mount) | – fire-and-forget telemetry | – swallowed | n/a | – |
| 7 | `createContract` | `create-contract-form.tsx:486` | ⚠️ text-only — "Sending…" | ✅ label → "Try again" + `text-error` | n/a | ✅ `disabled={isPending}` |
| 8 | `createInvoice` | `create-invoice-form.tsx:155` | ⚠️ text-only — "Sending…" | ✅ `text-sm text-error` above the button | n/a | ✅ `disabled={isPending}` |
| 9 | `archiveQuote` | `archive-quote-button.tsx:20` | ⚠️ text-only — "Archiving…" | ⚠️ label → "Try again" only; **no message explains what failed** | n/a | ✅ `disabled={isPending}` |
| 10 | `markInvoicePaid` | `mark-as-paid-button.tsx:160` | ⚠️ text-only — "Marking as paid…" | ✅ `text-sm text-error` in the sheet | n/a | ✅ `disabled={pending}` |
| 11 | `acceptQuote` | `quote-response.tsx:48` | ⚠️ text-only — "Accepting…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={isPending}` |
| 12 | `declineQuote` | `quote-response.tsx:51` | ⚠️ text-only — "Declining…" | ✅ shared error line | n/a | ✅ `disabled={isPending}` |
| 13 | `signContract` | `contract-response.tsx:95` | ⚠️ text-only — "Signing…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={isPending \|\| !canSign}` |
| 14 | `declineContract` | `contract-response.tsx:98` | ⚠️ text-only — "Declining…" | ✅ shared error line | n/a | ✅ `disabled={isPending}` |
| 15 | `saveContractorSetup` (explicit Save) | `setup-form.tsx:925` | ⚠️ text-only — "Saving…" | ✅ `text-sm text-error` above the button | n/a | ✅ `disabled={isPending}` |
| 16 | `autosaveContractorSetup` (debounced 900ms) | `setup-form.tsx:392` — no trigger | ⚠️ a 12px "Saving…" beside the Save button | ⚠️ 12px `text-error` line | n/a | – no trigger to disable |
| 17 | `savePayoutDetails` | `payout-details-section.tsx:103` | ⚠️ text-only — "Saving…" | ✅ `text-sm text-error` + zod message | n/a | ✅ `disabled={saving}` |
| 18 | `saveNotificationPreferences` | `settings-client.tsx:142` (each `Checkbox`) | ❌ **none on the checkbox** — only a paragraph 3 rows up swaps to "Saving…" | ❌ **none — a failed save is silent and the box stays ticked** | n/a | ❌ **no** — checkboxes stay live and can be toggled mid-save |
| 19 | `startStripeOnboarding` | `stripe-connect-section.tsx:69`, `:86`, `:103` | ⚠️ text-only — "Connecting to Stripe…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={starting}` |
| 20 | `startFeeMandate` | `fee-billing-section.tsx:53`, `:76` | ⚠️ text-only — "Connecting to your bank…" | ✅ `text-sm text-error` | n/a | ✅ `disabled={starting}` |
| 21 | `requestAccountDeletion` | `delete-account.tsx:62` | ⚠️ text-only — "Deleting…" | ❌ **none — the action can reject and nothing is shown** | n/a | ✅ `disabled={isPending}` |
| 22 | `cancelAccountDeletion` | `delete-account.tsx:31` | ⚠️ text-only — "Restoring…" | ❌ **none** | n/a | ✅ `disabled={isPending}` |
| 23 | `signOut` (form action) | `app-header.tsx:50`, `setup/page.tsx:66`, `setup/voice/page.tsx:423` | ❌ **none** | ❌ **none** | n/a | ❌ **no** |
| 24 | `trackSignup` | `signup/page.tsx:62` | – fire-and-forget | – swallowed | n/a | – |

### 4.2 Direct network calls

| # | Action | Trigger (file:line) | Loading | Error | Empty | Trigger disabled in flight |
|---|---|---|---|---|---|---|
| 25 | `fetch /api/companies-house/search` | `setup-form.tsx:498` | ⚠️ text-only — "Searching…" | ✅ `text-sm text-error` | ❌ **none — zero results renders nothing at all; the screen is unchanged and the search reads as broken** | ✅ `disabled={chSearching}` |
| 26 | `fetch /api/stripe/create-payment-intent` → `loadStripe` → `confirmPayment` | `pay-button.tsx:78` | ⚠️ text-only — "Connecting to your bank…" | ✅ `text-sm text-error`, with a specific message for `AMOUNT_TOO_HIGH` | n/a | ✅ `disabled={loading}` |
| 27 | `supabase.auth.signInWithPassword` | `login/page.tsx:118` | ⚠️ text-only — "Signing in..." | ✅ `text-sm text-error` | n/a | ✅ `disabled={status === "sending"}` |
| 28 | `supabase.auth.signInWithOtp` | `login/page.tsx:150` | ⚠️ text-only — "Sending..." | ✅ `text-sm text-error` | n/a | ✅ `disabled` |
| 29 | `supabase.auth.signUp` | `signup/page.tsx:125` | ⚠️ text-only — "Creating account..." | ✅ `text-sm text-error` | n/a | ✅ `disabled` |
| 30 | `setSession` / `verifyOtp` / `exchangeCodeForSession` | `auth/confirm/page.tsx:23` (on mount) | ⚠️ a bare `text-sm text-text-secondary` "Signing you in…" — **no spinner, no skeleton** | ✅ a full "Sign-in link expired" screen | n/a | – no trigger |
| 31 | `registerWebPush` / `registerNativePush` | `settings-client.tsx:115` | ⚠️ text-only — "Enabling…" | ⚠️ toast only — same neutral toast styling as success | n/a | ✅ `disabled={enabling}` |
| 32 | `sendTestNotification` | `settings-client.tsx:122` | ⚠️ text-only — "Sending…" | ⚠️ toast only | n/a | ✅ `disabled={testing}` |
| 33 | `navigator.clipboard.writeText` | `copy-link-button.tsx:23`, `bank-transfer-details.tsx:30` | ❌ none (sub-frame operation) | ✅ toast "Couldn't copy — try again." | n/a | ❌ no |

### 4.3 File upload

| # | Action | Trigger (file:line) | Loading | Error | Empty | Trigger disabled in flight |
|---|---|---|---|---|---|---|
| 34 | `supabase.storage.upload` (logo) | `logo-upload.tsx:127` | ⚠️ text-only — "Uploading…" | ✅ `text-xs text-error` (type, size, auth and upload failures each have their own message) | ✅ "No logo" dashed placeholder | ✅ `disabled={uploading}` |
| 35 | `supabase.storage.remove` (logo) | `logo-upload.tsx:136` | ❌ **none — the Remove button shows nothing while the delete is in flight** | ❌ **none — a failed remove is swallowed and the UI still clears the logo** | n/a | ⚠️ `disabled={uploading}` — but `uploading` is never set by `handleRemove`, so **the button is live during its own request** |

### 4.4 Voice capture

| # | Action | Trigger (file:line) | Loading | Error | Empty | Trigger disabled in flight |
|---|---|---|---|---|---|---|
| 36 | `createRealtimeSession` + `getUserMedia` + WebRTC SDP (job intake) | `jobs/new/page.tsx:1179` (`MicExplainer` → Start) | ✅ `callState="connecting"` → "Connecting…" status line and a dimmed orb | ✅ **best in the app** — `MicFailureScreen` with per-cause copy, a deep link to iOS Settings, retry, and a typed-quote fallback | ✅ the explainer screen is the pre-permission empty state | ✅ `disabled={starting}` on the Start button |
| 37 | `saveSowDelta` (per tool call, mid-call) | `jobs/new/page.tsx:712` — no trigger | ❌ none — silent | ❌ **swallowed by design** ("a single failed save shouldn't kill the live conversation") | n/a | – |
| 38 | `completeSowConversation` (draft the quote) | `jobs/new/page.tsx:429` — automatic on wrap | ✅ **the only real staged progress UI**: two numbered stages with a spinner ring on the active one, `aria-live="polite"`, 90s timeout | ✅ a dedicated stall screen with Retry and "Save and finish later" | n/a | – automatic |
| 39 | `saveVoiceTranscript` ("Save and finish later") | `jobs/new/page.tsx:1392` | ⚠️ text-only — "Saving…" | ❌ **none — best-effort; failure is swallowed and the user is navigated away regardless** | n/a | ✅ `disabled={savingForLater}` |
| 40 | `createManualJob` (typed fallback) | `mic-permission-screen.tsx:71`, `:132` | ⚠️ text-only — "Opening…" | ✅ `text-sm text-error` on the explainer screen | n/a | ✅ `disabled={manualPending}` |
| 41 | `saveContractorFirstName` | `jobs/new/page.tsx:778` — no trigger | ❌ none | ❌ swallowed | n/a | – |
| 42 | `recordTeamMember` | `jobs/new/page.tsx:806` — no trigger | ❌ none | ❌ swallowed | n/a | – |
| 43 | `reportVoicePipelineFailure` | `jobs/new/page.tsx:451` | – telemetry | – swallowed | n/a | – |
| 44 | `createSetupRealtimeSession` + `getUserMedia` (business setup) | `setup/voice/page.tsx:450` | ⚠️ "Connecting…" status line only — **no equivalent of the job-intake orb states** | ✅ `MicFailureScreen`, same as job intake | ✅ explainer screen | ✅ `disabled={starting}` (always passed `false`) |
| 45 | `completeSetupConversation` | `setup/voice/page.tsx:81` — "Done — save my details" | ⚠️ status line swaps to "Saving your details…"; **the trigger button itself shows nothing** | ✅ `text-sm text-error` + "Try again" + a manual-form escape hatch | n/a | ❌ **no — "Done — save my details" stays live and can be tapped repeatedly**; only an `endedRef` latch prevents a double save |

### 4.5 Google Places (address autocomplete)

| # | Action | Trigger (file:line) | Loading | Error | Empty | Trigger disabled in flight |
|---|---|---|---|---|---|---|
| 46 | `loadPlacesLibrary` + `fetchAutocompleteSuggestions` (250ms debounce) | `address-autocomplete.tsx:124` — on typing | ❌ **none — no spinner, no "searching" affordance** | ❌ **none — a failed fetch silently closes the dropdown; indistinguishable from "no matches"** | ❌ **none — zero suggestions shows nothing** | – no trigger |
| 47 | `place.fetchFields` (on selection) | `address-autocomplete.tsx:136` | ❌ none | ⚠️ falls back to the prediction text; the user is never told the detail lookup failed | n/a | – |

### 4.6 Summary

**47 async actions in total.**

| Measure | Count | Detail |
|---|---|---|
| **No loading state at all** | **10** | #5 update fixed price · #18 notification prefs · #23 sign out · #33 clipboard copy · #35 logo remove · #37 `saveSowDelta` · #41 `saveContractorFirstName` · #42 `recordTeamMember` · #46 places autocomplete · #47 `fetchFields` |
| Loading state is a **text-only label swap** | **32** | Every server action and network call with a trigger, bar the two below |
| **Real spinner or staged progress** | **2** | #38 `completeSowConversation` (the two-stage screen) and #36 the voice-connect orb |
| Fire-and-forget telemetry (no user-facing state by design) | 3 | #6, #24, #43 |
| **No error state** | **10** | #18 · #21 · #22 · #23 · #35 · #37 · #39 · #41 · #42 · #46 |
| **Empty state applies but is missing** | **2** | #25 Companies-House search · #46 address autocomplete |
| **Trigger stays live in flight** | **5** | #18 notification prefs · #23 sign out · #33 clipboard copy · #35 logo remove (guard reads the wrong flag) · #45 "Done — save my details" |

`Button` ships a spinner (`loading` prop) and a success tick (`success` prop) with `aria-busy` wired up. **Not one of the 47 async actions uses it.** Every "loading" state in the product is a string.

---

## 5. Native-feel audit (WKWebView)

The iOS app is a Capacitor shell (`capacitor.config.ts`) pointing a WKWebView at `https://motko.app` with `contentInset: "always"` and `limitsNavigationsToAppBoundDomains: false`. `NativeAppInit` adds `.native-app` to `<html>` when `Capacitor.isNativePlatform()`.

| Concern | Status | Where | Detail |
|---|---|---|---|
| **`-webkit-tap-highlight-color`** | ✅ Handled | `globals.css:148` | `-webkit-tap-highlight-color: transparent` on `html`. Applies on web too |
| **`user-select` on interactive elements** | ✅ Handled, native-only | `globals.css:163-176` | `.native-app body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none }`, with `input`, `textarea`, `[contenteditable]` and `.selectable` opted back in. Correctly scoped so web visitors keep selection. **`.selectable` is defined but applied to nothing** — so in the app a customer cannot select-and-copy an invoice amount, a payment reference, a sort code or a contract clause. The bank-transfer panel mitigates this with Copy buttons; nothing else does |
| **`touch-action` / double-tap zoom** | ✅ Handled | `globals.css:147`, `layout.tsx:40-44` | `touch-action: manipulation` on `html` kills the 300ms delay and double-tap zoom; the viewport is additionally locked with `maximumScale: 1, userScalable: false`. **`userScalable: false` also disables pinch-zoom for low-vision users** — a WCAG 1.4.4 failure, and a deliberate trade-off the comment acknowledges only for layout reasons |
| **`overscroll-behavior`** | ✅ Handled | `globals.css:151-155` | `overscroll-behavior: none` on `html, body`; `overflow-x: clip` (deliberately not `hidden`, with a comment explaining the iOS scroll trap that caused) |
| **`safe-area-inset`** | ⚠️ Partial | `globals.css:242-251`, `layout.tsx:54` | `.px-safe`, `.pt-safe`, `.pb-safe` are defined. **`.pt-safe` is never used.** `.px-safe` is applied once (`<body>`); `.pb-safe` twice (toast container, mark-as-paid sheet). `OfflineBanner` bypasses the utilities entirely with an inline `paddingTop: max(0.5rem, env(safe-area-inset-top))`. Vertical insets are otherwise left to Capacitor's `contentInset: "always"` |
| **Haptics** | ❌ **Absent** | — | `@capacitor/haptics@^7` is a declared dependency and **is never imported anywhere in `src/`.** The only haptic-adjacent call is `navigator.vibrate(35)` at `jobs/new/page.tsx:289`, fired once per voice turn when the app stops listening. **The Vibration API is not implemented in iOS Safari or WKWebView**, so this is a no-op on the target platform. Net: **zero haptic feedback in the iOS app** — no impact on send, accept, sign, mark-as-paid, or any other consequential action |
| **Rubber-banding scroll containers** | ⚠️ 3 at risk | see below | `overscroll-behavior: none` is set on `html, body` only — it does **not** cascade to nested scrollers |
| **`:hover` used where `:active` belongs** | ❌ **Systemic** | 12 distinct `hover:` classes, 40 occurrences vs **1** `active:` | See below |

### 5.1 Scroll containers

| Container | File:line | Risk |
|---|---|---|
| Voice transcript | `jobs/new/page.tsx:1161`, `:1205` | `style={{ maxHeight: "200px", overflowY: "auto" }}` with **no `overscroll-behavior`**. Scrolling past either end propagates to the page and rubber-bands. Also has JS auto-scroll (`:857`) that fights the user's own scroll — mitigated by an `isAutoScrollEnabled` bottom-detection at `:1125` |
| Voice conversation log | `setup/voice/page.tsx:570` | `max-h-56 overflow-y-auto`, **no `overscroll-behavior`**, plus an unconditional `scrollIntoView({ behavior: "smooth" })` on every transcript change (`:223`) that will yank the page if the container is off-screen |
| Address suggestion dropdown | `address-autocomplete.tsx:196` | `overflow-hidden`, absolutely positioned, `z-10`. Does not scroll — but it also does not cap its own height, so a long list can run off-screen with no way to reach the bottom entries |
| `<body>` | `globals.css:151-155` | Correct — `overscroll-behavior: none`, `overflow-x: clip` |

### 5.2 `:hover` where `:active` would be correct

Touch devices synthesise hover on tap and then **leave it stuck** until the next tap elsewhere. Every one of these is a touch target whose only state feedback is a hover:

| Class | Count | The problem |
|---|---|---|
| `hover:text-primary-hover` | 8 | Copy buttons, customer-name links, `InlineLink`, mark-as-paid link — the sole press feedback on all of them |
| `hover:text-foreground` | 7 | Every sign-out button, nav items, `PageHeader` back, filter chips |
| `hover:text-accent-hover` | 6 | All four voice-screen text buttons and both auth footer links |
| `hover:underline` | 5 | Dashboard and `PipelineRow` customer links — **the underline is the only affordance that the name is a link**, and it does not exist until you tap |
| `hover:bg-surface-hover` | 4 | `Button` secondary/tertiary, and both picker-row lists. On the picker rows this is the **only** selection feedback |
| `hover:text-error` | 3 | Every "Remove" control — the destructive affordance is hover-only |
| `hover:text-primary` | 2 | `ArchiveQuoteButton`, `BackToDashboard` |
| `hover:bg-primary-hover` | 1 | `Button` primary |
| `hover:border-border` | 1 | **The inline line-item description field at `quote-editor.tsx:477` is borderless until hovered.** On touch there is no indication it is editable at all |
| `hover:opacity-90` | 1 | "Yes, delete my account" |
| `hover:text-text-primary` | 1 | "Dismiss" — and the token is undefined, so nothing happens on any device |
| `hover:text-text-secondary` | 1 | Maker's mark |

**One `active:` state exists in the whole product UI**: `active:scale-[0.98]` inside `buttonClass`. Everything not built on `Button`/`buttonClass` — all 52 controls counted in §2.4 — has no press feedback of any kind on touch.

### 5.3 Other native-shell observations

- **Status bar**: `StatusBar.setStyle({ style: Style.Light })` at `native-app-init.tsx:60`, matched to the `#004225` splash/background in `capacitor.config.ts`.
- **Keyboard**: `KeyboardManager` (`components/keyboard-manager.tsx`) is a plugin-free helper that scrolls the focused field clear of the keyboard via `visualViewport` and blurs on outside taps. `@capacitor/keyboard` is configured (`resize: "native"`, `accessoryBarVisible: true`) but never imported in `src/`.
- **Format detection**: `layout.tsx:27-32` disables telephone/date/address/email auto-linking to stop iOS rewriting the DOM before hydration.
- **App-resume**: `native-app-init.tsx:77-162` revalidates the session after 30s in background and refreshes non-exempt routes.
- **Splash**: `@capacitor/splash-screen` hidden on mount; `launchShowDuration: 1200`, `showSpinner: false`.
- **`window.confirm()`** at `archive-quote-button.tsx:21` renders as a system alert titled with the origin inside the WKWebView — the one place the app visibly breaks the native illusion.
- **No pull-to-refresh, no swipe-back gesture handling, no scroll-position restoration** are implemented anywhere.


---

## 6. Typography and hierarchy

### 6.1 The actual type scale, largest first

| px | rem | Utility | Occurrences | Effective line-height | Where it is used |
|---|---|---|---|---|---|
| 36px | 2.25rem | `text-4xl` | 1 | 2.5rem (40px) | The dashboard "you're owed" figure — `dashboard-hero.tsx:29`. The single largest thing in the app |
| 30px | 1.875rem | `text-3xl` | 1 | 2.25rem (36px) | The invoice "amount due" — `i/[id]/page.tsx:115` |
| 24px | 1.5rem | `text-2xl` | 24 | 2rem (32px) | Every page `<h1>`, and the quote/contract/invoice grand total |
| 20px | 1.25rem | `text-xl` | 1 | 1.75rem (28px) | The company-initial fallback tile on the payment receipt — `i/[id]/paid/page.tsx:59`. **Not a heading** |
| **19.2px** | — | inline `fontSize: size * 0.4` | 1 | — | `Monogram` initials at the default `size = 48` — `monogram.tsx:53`. Off-scale |
| 18px | 1.125rem | `text-lg` | 31 | 1.75rem (28px) | Section `<h2>`s (dashboard, settings, legal pages), card titles, the "all square" line |
| 16px | 1rem | `text-base` | 5 | 1.5rem (24px) | `<h3>` in the contract body, the active follow-up question, "Next step", the mic-failure title. Also `body { font-size: 16px }` |
| 14px | 0.875rem | `text-sm` | **212** | 1.25rem (20px) | Body copy, every button label, every input, every list row. **The default size of the app** |
| 12px | 0.75rem | `text-xs` | **119** | 1rem (16px) | Every field label, every section eyebrow, every hint, every status chip, every "Remove"/"Dismiss" |

**Eight utility sizes plus one off-scale inline size = nine distinct sizes.**

Two of the nine are used once each and neither is a heading. `text-sm` and `text-xs` together account for **331 of 395 sizing declarations (84%)** — the app is essentially a two-size design with five decorative exceptions.

### 6.2 Sizes within 2px of each other

Every adjacent pair below the 24px break is within 2px:

| Pair | Δ | Both in use? |
|---|---|---|
| **12px `text-xs` ↔ 14px `text-sm`** | 2px | Yes — 119 and 212 occurrences. The two workhorse sizes, and they are one step apart |
| **14px `text-sm` ↔ 16px `text-base`** | 2px | Yes — 212 and 5 |
| **16px `text-base` ↔ 18px `text-lg`** | 2px | Yes — 5 and 31 |
| **18px `text-lg` ↔ 19.2px `Monogram`** | 1.2px | Yes — 31 and 1 |
| **19.2px `Monogram` ↔ 20px `text-xl`** | 0.8px | Yes — 1 and 1 |
| **18px `text-lg` ↔ 20px `text-xl`** | 2px | Yes — 31 and 1 |

Six colliding pairs. The 16–20px band contains **four** distinct sizes (16, 18, 19.2, 20) inside a 4px range, of which three are used a combined 7 times.

Above the break the scale is clean: 24 → 30 → 36 (Δ6 each).

### 6.3 Hierarchy is carried by weight and colour, not size

Because 84% of text is one of two sizes, the visible hierarchy is doing its work through:

- **Weight** — only `font-medium` (500, 124×) and `font-semibold` (600, 79×). No 400 body weight (the `body` default is Inter's 400 via `font-family` only), no 700.
- **Colour** — `text-text-secondary` (162×) vs default foreground vs `text-text-muted` (31×). Three greys: `#222222`, `#717171`, `#949494`.
- **Case + tracking** — `text-xs uppercase tracking-wide text-text-secondary`, the section eyebrow, 43×.

A `text-sm font-medium` label and a `text-sm` body line differ only by a 100-unit weight step. A section eyebrow and a field label are the same size, weight and colour and differ only by `uppercase tracking-wide`.

### 6.4 Dynamic Type and rem-based sizing

| Question | Answer |
|---|---|
| Is Dynamic Type supported? | **No.** No `-apple-system-body`, no `font: -apple-system-body`, no text-style font shorthand, and no `@media (prefers-*)` type rules anywhere in `src/`. |
| Is rem-based sizing used? | **Implicitly, and it is then defeated.** Tailwind's `text-*` utilities emit `rem` values, so they would track the browser's root font size. But `html` never sets `font-size`, `body` sets a hard `font-size: 16px` (`globals.css:182`), and `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100% }` (`globals.css:145-146`) pins the computed size against iOS's own text inflation. |
| Can the user zoom? | **No.** `layout.tsx:42-43` sets `maximumScale: 1, userScalable: false`. |
| Explicit `rem` in the product UI | **One** — `paddingTop: "max(0.5rem, env(safe-area-inset-top))"` at `offline-banner.tsx:30`. Not type-related. |

Net: a contractor who has raised iOS text size to accommodate poor sight gets **no change at all** in this app. The smallest text — the field labels, hints, "Remove" and "Dismiss" controls, and every section eyebrow — is fixed at 12px.

### 6.5 The font stack

`globals.css:116-117`:

```
--font-sans: "Airbnb Cereal", Circular, var(--font-inter), -apple-system,
  "Helvetica Neue", Arial, sans-serif;
```

**"Airbnb Cereal" and "Circular" are never loaded.** There is no `@font-face` rule anywhere in `src/`, no font file in `public/`, and no `<link>` to a font host. Both are proprietary faces (Airbnb's and Spotify's respectively). The stack therefore always falls through to `var(--font-inter)` — Inter, correctly loaded via `next/font/google` in `layout.tsx:9-12`. The two leading entries are inert, and would be a licensing problem if they ever resolved.

`h1`–`h4` get `letter-spacing: -0.02em` (`globals.css:187-192`). Nothing sets `font-feature-settings`; `.tabular-nums` (`globals.css:231-233`) is applied to money and dates in 20 places.

---

## 7. Route map

Scope list for the sweep. Marketing routes are excluded and listed separately at the bottom for completeness.

### 7.1 Authenticated product routes

| Route | File | Components rendered |
|---|---|---|
| `/dashboard` | `src/app/dashboard/page.tsx` | `AppHeader` · `FeeRunwayBanner` · `DashboardHero` → `CountUp` · `Card` ×n · `EmptyState` ×4 · `PipelineRow` → `StatusChip` ×3 groups · `CreateContractForm` · `CreateInvoiceForm` · `ArchiveQuoteButton` ×2 · `MarkAsPaidButton` · `InlineLink` ×7 · `StatusChip` · `buttonClass` links ×2 · free-jobs chip · missing-profile warning card |
| `/jobs` | `src/app/jobs/page.tsx` | `AppHeader` · filter chips ×5 · search form · totals band · `PipelineRow` ×n · `EmptyState` · `buttonClass` links ×3 |
| `/jobs/[id]` | `src/app/jobs/[id]/page.tsx` | `PageHeader` · sent banner · `StatusChip` · `Card` ×9 · `PipelineStepper` · `Badge` · move pill · `BlockedAction` ×2 · `CopyLinkButton` ×5 · `InlineLink` ×4 · `MarkAsPaidButton` ×2 · `CreateContractForm` · `CreateInvoiceForm` · `QuoteEditor` · `ActivityTimeline` · wrap-incomplete anchor card · transcript `<details>` |
| `/jobs/[id]` (editor) | `src/app/jobs/[id]/quote-editor.tsx` | `Card` ×n · `Input` ×12 · `Checkbox` ×3 · `Button` ×8 · draft-failed card · pricing-mode card · per-line flag `<details>` · flags panel · send panel |
| `/jobs/new` | `src/app/jobs/new/page.tsx` | `PageHeader` · transcript scroller · `MicExplainer` / `MicFailureScreen` · `Card` ×2 · voice orb · `Button` ×4 · staged-progress list · stall/failure screen |
| `/motko` | `src/app/motko/page.tsx` | `AppHeader` · `Card` ×2 · `buttonClass` links ×2 |
| `/setup` | `src/app/setup/page.tsx` | `AppHeader` **or** a bespoke header · `buttonClass` link · `SetupForm` |
| `/setup` (form) | `src/app/setup/setup-form.tsx` | `Input` ×14 · `MoneyInput` ×7 · `ConstrainedField` ×4 · `Checkbox` ×n · `Textarea` · `AddressAutocomplete` · `LogoUpload` · `Button` ×4 · CH search + results list · colour picker · 7 `<section>`s |
| `/setup/voice` | `src/app/setup/voice/page.tsx` | `PageHeader` (+ sign-out) · `MicExplainer` / `MicFailureScreen` · `Card` ×4 · simple orb · 3 text buttons · 2 `Link`s |
| `/settings` | `src/app/settings/page.tsx` | `AppHeader` · `PayoutDetailsSection` · `StripeConnectSection` · `FeeBillingSection` · `FeesStatementSection` · `ReferralSection` · `SettingsClient` · `DeleteAccount` — all `Card`-based |

### 7.2 Auth routes

| Route | File | Components rendered |
|---|---|---|
| `/login` | `src/app/login/page.tsx` | `Input` ×2 (or ×1) · `Button` ×2 · `Link` · two form modes (password / magic link) |
| `/signup` | `src/app/signup/page.tsx` | `Input` ×3 · `Button` · `Link` |
| `/auth/confirm` | `src/app/auth/confirm/page.tsx` | Plain "Signing you in…" text, or an expired-link screen with a `buttonClass` `Link` |
| `/auth/error` | `src/app/auth/error/page.tsx` | Expired-link screen — a near-duplicate of the `/auth/confirm` failure branch |

### 7.3 Public customer-facing routes (capability URLs)

| Route | File | Components rendered |
|---|---|---|
| `/q/[id]` | `src/app/q/[id]/page.tsx` | `BackToDashboard` (owner only) · logo `<img>` or `Monogram` · `Card` (divided line items) · totals block · `QuoteResponse` (2 `Button`s) · `InlineLink` · footer terms · `MadeWithMotko` |
| `/c/[id]` | `src/app/c/[id]/page.tsx` | `BackToDashboard` · owner-preview notice card · logo/`Monogram` · `Card` (deposit/balance) · `ContractBody` (markdown → h2/h3/h4/p/blockquote/ul/table/hr) · `ContractResponse` (`Input` + `Checkbox` + 2 `Button`s) · `InlineLink` · `MadeWithMotko` |
| `/i/[id]` | `src/app/i/[id]/page.tsx` | `BackToDashboard` · logo/`Monogram` · `Card` · `PayButton` · `ReassuranceStrip` · `BankTransferDetails` (5 `Row`s, 3 copy buttons) · `<details>` toggle · setup-incomplete warning · `MadeWithMotko` |
| `/i/[id]/paid` | `src/app/i/[id]/paid/page.tsx` | Logo `<img>` or a bespoke initial tile · receipt text · `MadeWithMotko` |

### 7.4 Legal / support

| Route | File | Components rendered |
|---|---|---|
| `/privacy` | `src/app/privacy/page.tsx` | `PageHeader` · 8 prose `<section>`s · 3 mailto links |
| `/support` | `src/app/support/page.tsx` | `PageHeader` · 2 prose `<section>`s · 3 links |

Both link `backHref="/"` — which, inside the native shell, lands on the marketing page.

### 7.5 Layout, boundaries and skeletons

| File | Renders |
|---|---|
| `src/app/layout.tsx` | `<html>`/`<body>` · `NativeAppInit` · `KeyboardManager` · `OfflineBanner` · `ToastProvider` |
| `src/app/error.tsx` | `ErrorState` (route-level boundary) |
| `src/app/global-error.tsx` | Own `<html>`/`<body>` + a hand-rolled retry button (imports nothing) |
| `src/app/jobs/new/error.tsx` | `PageHeader` · `Card` (raw error text) · `Button` |
| `loading.tsx` ×11 | `dashboard`, `jobs`, `jobs/[id]`, `jobs/new`, `settings`, `setup`, `setup/voice`, `motko`, `q/[id]`, `c/[id]`, `i/[id]` — all `Skeleton` + `Card`. **5 of the 11 set `aria-hidden="true"` on the root; 6 do not** (`dashboard`, `jobs/[id]`, `settings`, `q/[id]`, `c/[id]`, `i/[id]`) |

**No `loading.tsx` exists for** `/login`, `/signup`, `/auth/confirm`, `/auth/error`, `/i/[id]/paid`, `/privacy`, `/support`.

### 7.6 Excluded from this inventory

| Route | File | Why |
|---|---|---|
| `/` | `src/app/(marketing)/page.tsx` + `layout.tsx` + `marketing.css` + 8 components in `_components/` | Marketing |
| `/opengraph-image` | `src/app/(marketing)/opengraph-image.tsx` | Marketing |
| `/api/**` (17 handlers) | `src/app/api/**` | No rendered UI |
| `/robots.txt`, `/sitemap.xml`, `/.well-known/apple-app-site-association` | — | Non-visual |


---

## 8. Things that look obviously wrong

Noted and left alone, per the brief. Ordered by how load-bearing they are.

1. **Two Tailwind colour utilities resolve to nothing.** `@theme inline` (`globals.css:76-121`) exports `--color-text-secondary` and `--color-text-muted` but **not** `--color-text-primary`, and no `--color-surface-secondary` at all. So:
   - `bg-surface-secondary` — `reassurance-strip.tsx:35`. The payment-reassurance card on `/i/[id]` renders **with no background fill**.
   - `text-text-primary` — `reassurance-strip.tsx:36`, `:58`. That card's body text falls back to inherited colour.
   - `hover:text-text-primary` — `quote-editor.tsx:682`. The "Dismiss" control has no hover state on any device.

2. **`@capacitor/haptics` is installed and never used.** The only haptic call in the app is `navigator.vibrate(35)` (`jobs/new/page.tsx:289`), and the Vibration API does not exist in iOS Safari or WKWebView. The iOS app produces no haptic feedback for any action, including send-quote, sign-contract and mark-as-paid.

3. **`--dur-slow` is declared twice** in the same `:root` block — `360ms` at `globals.css:42`, then `600ms` at `:45` under a duplicate `/* ── Duration ── */` heading. Neither is ever read.

4. **Nine motion and elevation tokens are defined and never used:** `--dur-instant`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-standard`, `--ease-out`, `--radius-pill`, and the `shadow-hairline` / `shadow-raised` / `shadow-overlay` / `shadow-card` utilities. Every animated thing in the app hard-codes its own duration instead.

5. **The font stack names two proprietary faces that are never loaded.** `"Airbnb Cereal", Circular, …` (`globals.css:116`) — no `@font-face`, no font files in `public/`, no font `<link>`. Inert today; a licensing exposure if either ever resolved.

6. **`userScalable: false` + `maximumScale: 1`** (`layout.tsx:42-43`) disables pinch-zoom outright. Combined with a hard `body { font-size: 16px }` and `text-size-adjust: 100%`, a user with iOS text size raised gets no change at all. The smallest text in the app — every field label, hint, section eyebrow, "Remove" and "Dismiss" — is fixed at 12px.

7. **`.selectable` is defined and applied to nothing.** `globals.css:172` opts elements back into text selection inside the native shell, but no element in `src/` carries the class. In the iOS app a customer cannot select-and-copy an invoice amount, a payment reference, a contract clause or an address. Only the bank-transfer panel works around this, with explicit Copy buttons.

8. **`.pt-safe` is defined and never used** (`globals.css:246-248`). `OfflineBanner` needed the same thing and wrote an inline `paddingTop: max(0.5rem, env(safe-area-inset-top))` instead — because `.pt-safe` has no `max()` floor and would collapse to 0 off-notch.

9. **`logo-upload.tsx:133` guards the wrong flag.** The Remove button is `disabled={uploading}`, but `handleRemove` never sets `uploading` — so the button stays live throughout its own storage delete, and a double-tap fires two deletes.

10. **The mark-as-paid sheet has no focus management.** `mark-as-paid-button.tsx:96` sets `role="dialog"` and `aria-modal="true"` but implements no focus trap, no focus restore on close, no Escape handler and no body scroll lock. The dismiss affordance is a `<div onClick>` backdrop with no `tabIndex` — keyboard users cannot dismiss it at all.

11. **`window.confirm()` for archive** (`archive-quote-button.tsx:21`) is the only destructive confirmation not rendered in-app. Inside the WKWebView it appears as an iOS system alert titled with the origin.

12. **Four `<summary>` disclosures have no focus-visible style.** `globals.css:221-227` scopes the focus ring to `a`, `button` and `[tabindex]`; `<summary>` matches none of them, so `create-contract-form.tsx:307`, `i/[id]/page.tsx:135`, `jobs/[id]/page.tsx:672` and `quote-editor.tsx:489` are keyboard-focusable with no visible focus.

13. **The `Button` component's spinner and success states are dead code.** `loading` and `success` props exist, render a real spinner overlay and a tick, and wire up `aria-busy` — and **not one of the 47 async actions passes either.** Every loading state in the product is a label swapping to a string ending in "…".

14. **`Badge` and `StatusChip` have byte-identical class strings** (`badge.tsx:20`, `status-chip.tsx:45`), and the same string is written out a third time inline at `jobs/[id]/page.tsx:481` for the move pill.

15. **`CopyLinkButton` and `CopyValueButton` are independent implementations of the same control** with byte-identical class strings and byte-identical toast behaviour (`copy-link-button.tsx:21`, `bank-transfer-details.tsx:25`).

16. **The control class string is triplicated verbatim** — `h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground` appears at `select.tsx:16`, `setup-form.tsx:76` (as a local `controlClass` const), and `mark-as-paid-button.tsx:144`.

17. **`Select` is the only form primitive with no error or hint slot**, so the contract-type and invoice-type selects can never show validation.

18. **The inline line-item description field only reveals itself on hover** (`quote-editor.tsx:477`, `border-transparent … hover:border-border`). On touch there is no indication it is editable.

19. **The address autocomplete dropdown never caps its height** (`address-autocomplete.tsx:196`, `overflow-hidden` with no `max-h`), so a long result list can run off-screen with no way to reach the bottom entries.

20. **The two voice-transcript scrollers have no `overscroll-behavior`** (`jobs/new/page.tsx:1161`, `:1205`; `setup/voice/page.tsx:570`). `overscroll-behavior: none` is set on `html, body` only and does not cascade to nested scrollers.

21. **`z-50` is shared by three unrelated fixed layers** — offline banner, toast stack, mark-as-paid sheet. Paint order is decided by DOM order alone and is nowhere declared.

22. **`/privacy` and `/support` both link `backHref="/"`**, which inside the native shell lands on the marketing page rather than anywhere in the app.

23. **Six of the eleven `loading.tsx` skeletons omit `aria-hidden="true"`** (`dashboard`, `jobs/[id]`, `settings`, `q/[id]`, `c/[id]`, `i/[id]`), so a screen reader announces the skeleton's empty `<div>`s (118 `Skeleton` instances across the 11 files). The other five set it.

24. **Notification preference saves are silent in both directions** (`settings-client.tsx:142`): no per-checkbox pending state, no error state, and the checkboxes stay live during the save. A failed save leaves the box ticked and the user unaware.

25. **`inline-flex` on `<a>` inside prose.** `InlineLink`'s `min-h-11` fix for tap targets (`inline-link.tsx:13`) makes it `inline-flex`, which is correct for a standalone action but breaks line-wrapping if ever used mid-sentence. It currently is not — but `jobs/[id]/quote-editor.tsx:777` needed a mid-sentence link and used a bare `<a className="underline">` instead, which then has no tap target at all.

---

## NUMBERS

```
Distinct colours ......................... 78 colour expressions
                                              (28 literal values + 49 Tailwind
                                              utilities + 1 arbitrary value),
                                              resolving to 42 distinct rendered
                                              colours. 2 of the 49 utilities
                                              resolve to nothing.
Distinct font sizes ...................... 9   (8 Tailwind utilities + 1 off-scale
                                              inline size); 6 pairs sit within 2px
Distinct spacing values .................. 66 utilities, resolving to 11 pixel
                                              values (0, 2, 4, 6, 8, 10, 12, 16,
                                              20, 24, 32) + auto + env()
Distinct radii ........................... 7  utilities, resolving to 4 pixel
                                              values (8, 12, 16, 9999)
                                              + 1 defined-but-unused token (999px)
Total interactive elements ............... 162 (118 own implementations
                                              + 43 composite call sites
                                              + 1 event-guard div)
Interactive elements, no pressed state ... 52  of 118
Interactive elements, no accessible name . 1   of 118
Parallel button implementations .......... 23 distinct press-target treatments
                                              (1 shared Button/buttonClass
                                              + 22 one-offs), plus 11 further
                                              link treatments = 34 distinct
                                              treatments for "a thing you tap"
Async actions with no loading state ...... 10  of 47
```

### Supporting counts

```
Files scanned ............................ 85
Distinct font weights .................... 3   (500, 600, and 400 used twice to undo 500)
Distinct line-height declarations ........ 2   (body 1.4, leading-relaxed on 2 legal pages)
Distinct border widths ................... 2   (1px ×71, 2px ×2) + 2 ring widths
Distinct box shadows ..................... 5   defined, 3 ever used, 4 usages total
Distinct z-index values .................. 2   (z-10, z-50)
Distinct transition durations ............ 10  hard-coded, 0 from the 4 duration tokens
Distinct easing functions ................ 3   defined, 1 ever used
Tailwind arbitrary values ................ 5   total across the whole product UI
Inline style blocks ...................... 9   (4 carry static, avoidable values)
hover: classes ........................... 12  distinct, 40 occurrences
active: classes .......................... 1   distinct, 1 occurrence
Interactive elements under 44pt .......... 31  of 118 (a further 47 pass on height
                                              but have unknown, content-driven width)
Interactive elements, no focus-visible ... 5   of 118 (4 <summary> + 1 backdrop div)
Async actions with no error state ........ 10  of 47
Async actions, trigger live in flight .... 5   of 47
Async actions with a real spinner ........ 2   of 47
Card-like treatments ..................... 1 shared (Card) + 22 bespoke
List-row-like treatments ................. 11
Modal/sheet implementations .............. 1   (+ 1 window.confirm, + 4 <details>)
Toast/banner implementations ............. 6
Section-eyebrow copy-paste ............... 43  identical inline class strings
Defined-but-unused design tokens ......... 9
```
