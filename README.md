# TradeQuote — AI Back Office for Small Contractors

Turn a tradesperson's site-visit voice note into a professional, branded quote — then handle invoicing and payment chasing — powered by a per-contractor knowledge layer that learns their rates, suppliers, and past jobs.

**Target user:** 2–10 person trade businesses (builders, electricians, plumbers, roofers).

Full build plan: [`docs/build-plan.pdf`](./docs/build-plan.pdf)

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) PWA, Tailwind |
| Backend | Next.js API routes (TypeScript) |
| Database | Postgres (Supabase) + pgvector |
| Auth | Supabase Auth |
| Speech-to-text | OpenAI Whisper API |
| LLM | Claude API (Sonnet for quoting, Haiku for cheap tasks) |
| Payments | Stripe (Invoicing + Payment Links) |
| PDF generation | react-pdf / Puppeteer |
| Email/SMS | Resend + Twilio |
| Hosting | Vercel + Supabase |

## Product phases

- **Phase 0** — Voice-first setup wizard (onboarding)
- **Phase 1** — Quoting MVP (build first)
- **Phase 2** — Invoicing & payment chasing
- **Phase 3** — Knowledge layer (per-contractor semantic memory)

## Guardrails

- Human in the loop, always — drafts are never sent without contractor review.
- Money accuracy is non-negotiable: all arithmetic done in code, never by the LLM.
- Flag assumptions explicitly in every AI-generated quote.
- Keep it light — no feature that requires training the contractor.

## Development

```bash
pnpm install
pnpm dev
```

## Address autocomplete (Google Places)

Every address field (business address in setup, client + site address on a
contract) uses the reusable `<AddressAutocomplete>` component
(`src/components/ui/address-autocomplete.tsx`), which wraps the **Google Places
API (New)** and is restricted to Great Britain. On selection it stores the
formatted address plus structured components (line 1/2, town/city, county,
postcode, lat/lng, place ID). If the script fails to load or the contractor
ignores the dropdown, whatever they typed still saves — selection is never
required.

### Setup

1. In [Google Cloud Console](https://console.cloud.google.com/) create (or pick)
   a project and enable the **Places API (New)** and **Maps JavaScript API**
   under *APIs & Services → Library*.
2. Create an API key under *APIs & Services → Credentials*.
3. Restrict the key (do this before shipping):
   - **Application restrictions → Websites (HTTP referrers):** add your domains,
     e.g. `http://localhost:3000/*`, `https://*.vercel.app/*`, and your
     production domain `https://yourdomain.com/*`.
   - **API restrictions → Restrict key:** allow only *Places API (New)* and
     *Maps JavaScript API*.
4. Add the key to your environment. It's a browser key (`NEXT_PUBLIC_`), so it is
   visible to clients — the referrer restriction above is what protects it:

   ```bash
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key
   ```

Leaving the variable unset simply disables autocomplete; address fields fall
back to plain text entry.
