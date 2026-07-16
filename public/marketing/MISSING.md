# Marketing screenshots — status

The landing page frames five product screens: `dashboard`, `quote`, `sow`,
`accept`, `job`. Until real PNG captures are committed here, the page renders a
**same-size neutral placeholder skeleton** (inline SVG in
`src/app/(marketing)/_components/screen-frame.tsx`) so layout stays dimensioned
(zero CLS) and the missing asset is visibly flagged as "— preview".

## How to produce the real captures

1. Install Playwright (one-time):
   ```
   pnpm add -D playwright
   pnpm dlx playwright install chromium
   ```
2. Seed the demo contractor (creates the login the capture script uses):
   ```
   pnpm dlx tsx scripts/seed-demo-contractor.ts
   ```
   Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Start the app: `pnpm dev`
4. Capture (390×844, dpr2 → `public/marketing/*.png`):
   ```
   pnpm dlx tsx scripts/capture-marketing-shots.ts
   ```
5. In `scripts/capture-marketing-shots.ts`, point `quote` / `sow` / `accept` /
   `job` at the specific seeded routes (they currently all fall back to
   `/dashboard` — see the TODOs).
6. Flip the matching entries in `HAS_REAL` (top of `screen-frame.tsx`) to `true`
   so the page swaps the placeholder for the real `<Image>`.

## Screens that cannot be captured non-interactively

- **`accept`** (customer accepted + signed): requires a customer to sign via a
  `/c/<token>` share link. Either seed an accepted+signed contract in
  `seed-demo-contractor.ts`, or capture manually:
  open the signed contract view at iPhone size (390×844, dpr2) and save as
  `public/marketing/accept.png`.

## Other assets to replace

- **Favicon**: currently the existing `src/app/favicon.ico` (green M placeholder).
  Replace with the final brand favicon set when brand assets are ready.
- **Hero video**: `src/app/(marketing)/_components/screen-frame.tsx` has a slot
  comment where a real screen-recording `<video>` can replace the static hero
  frame later.
