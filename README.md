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
