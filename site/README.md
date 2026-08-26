# motko.co.uk Marketing Site

Static marketing site for motko, to be deployed to motko.co.uk (separate from the motko.app product).

## Structure

- `index.html` - Homepage with "Your first three jobs are free" messaging, and
  the **only App Store link in either codebase** — motko.app is held to zero App
  Store references by `tests/regression/app-store-link.test.ts`, so if the
  listing moves, `site/index.html` is the one line to change.
- `pricing.html` - Full pricing page with fee ladder and referral rewards
- `styles.css` - Basic styling for the marketing site

## Deployment

This site should be deployed to motko.co.uk using Vercel or similar static hosting.

Configure the deployment:
1. Set the root directory to `site/`
2. Deploy to motko.co.uk domain
3. No build step required (static HTML)

## Key Messaging

### Homepage
- "Your first three jobs are free" (exact number "three")
- No "free while in early access" or similar open-ended claims
- No "beta" used to imply pricing

### Pricing Page
The pricing page publishes the complete fee structure:

**Fee Bands:**
- £2 per job up to £1,000
- £6 per job from £1,001 to £3,000
- £10 per job above £3,000

**Key Points:**
- Fees are VAT-inclusive
- Fee taken when customer pays (deducted from payment)
- Nothing charged until contractor is paid

**Referral Rewards:**
- 3 free jobs per referral who completes their first paid job
- After 5 successful referrals: 5 free jobs per referral
- Credits stack and accumulate

**Free Job Waiver Rule:**
- A free job covers the standard £2 fee
- On higher-value jobs (£6/£10 bands), the difference above £2 is payable

## Deployment Sequencing

⚠️ **Important:** This site should not be deployed ahead of FEE-3 (in-app fee surfaces). If the site states a price that the app doesn't display, this creates a worse mismatch than the current state.

Coordinate deployment with FEE-3 to ensure the app and marketing site are aligned.
