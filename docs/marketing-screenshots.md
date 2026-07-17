# Marketing screenshots — status

The landing page frames five product screens: `dashboard`, `quote`, `sow`,
`accept`, `job`. Until real PNG captures are committed here, the page renders a
**same-size neutral placeholder skeleton** (inline SVG in
`src/app/(marketing)/_components/screen-frame.tsx`) so layout stays dimensioned
(zero CLS) and the missing asset is visibly flagged as "— preview".

## Why they aren't captured yet

Captures could not be produced non-interactively in this environment:

- **Docker is not running**, so a throwaway **local** Supabase (`supabase start`)
  couldn't be brought up.
- The only reachable database is **production** Supabase (`.env.local` points at
  the remote project). Seeding a demo contractor there is a shared-state write to
  production, so it was intentionally **not** run automatically.
- **Playwright/Chromium is not installed** in this environment.

The pipeline below is turn-key — run it against a local or a disposable project.

## How to produce the real captures

1. Install Playwright (one-time):
   ```
   pnpm add -D playwright
   pnpm dlx playwright install chromium
   ```
2. Seed the demo contractor. Prefer a **local** Supabase so production stays
   untouched:
   ```
   supabase start            # needs Docker running
   pnpm dlx tsx scripts/seed-demo-contractor.ts
   ```
   Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
   environment. The script prints three ids at the end:
   ```
   DEMO_QUOTE_SENT=<uuid>
   DEMO_QUOTE_ACCEPTED=<uuid>
   DEMO_JOB=<uuid>
   ```
3. Start the app against that same database: `pnpm dev`
4. Capture (390×844, dpr2 → `public/marketing/*.png`), passing the ids:
   ```
   BASE_URL=http://localhost:3000 \
   DEMO_QUOTE_SENT=<uuid> DEMO_QUOTE_ACCEPTED=<uuid> DEMO_JOB=<uuid> \
   pnpm dlx tsx scripts/capture-marketing-shots.ts
   ```
   Screen → route mapping (already wired in the capture script):
   | file            | route                       | auth |
   |-----------------|-----------------------------|------|
   | `dashboard.png` | `/dashboard`                | yes  |
   | `quote.png`     | `/q/<DEMO_QUOTE_SENT>`       | no   |
   | `sow.png`       | `/q/<DEMO_QUOTE_SENT>`       | no   |
   | `accept.png`    | `/q/<DEMO_QUOTE_ACCEPTED>`   | no   |
   | `job.png`       | `/jobs/<DEMO_JOB>`          | yes  |
5. Flip the matching entries in `HAS_REAL` (top of `screen-frame.tsx`) to `true`
   so the page swaps each placeholder for the real `<Image>`. The frame renders a
   **top-anchored 4:5 crop** (`object-cover object-top`), so no manual cropping is
   needed — the capture's app bar + first rows fill the card.

## Notes on specific screens

- **`sow`** currently reuses the public quote view (`/q/<sent>`), since the
  customer-facing scope of work is the quote's line-item scope. If you'd rather it
  show the internal job scope, point `sow` at `/jobs/<DEMO_JOB>` in
  `scripts/capture-marketing-shots.ts` and re-capture.
- **`accept`** shows the quote once accepted/signed. The seeded "accepted" quote
  drives it via `/q/<DEMO_QUOTE_ACCEPTED>`; the `QuoteResponse` component renders
  the signed state. If you want the full customer sign flow instead, capture the
  `/c/<token>` share link view manually at 390×844 dpr2 and save as
  `public/marketing/accept.png`.
- Every customer-facing document keeps its **Powered by Motko** footer
  (`components/ui/powered-by-motko.tsx`) — do not remove it from captures.

## Other assets to replace

- **Favicon**: currently the existing `src/app/favicon.ico` (green M placeholder).
  Replace with the final brand favicon set when brand assets are ready.
- **OG image**: `src/app/(marketing)/opengraph-image.tsx` renders a designed
  quote/SoW mock (framed £992.50 quote). Swap the mock for the real `quote.png`
  once captured if you want a photographic OG.
- **Hero video**: `src/app/(marketing)/_components/screen-frame.tsx` has a slot
  comment where a real screen-recording `<video>` can replace the static hero
  frame later.
