/**
 * Rate limit configuration for all protected routes.
 */

export const RATE_LIMIT_CONFIG = {
  "create-payment": {
    limit: 20,
    windowSeconds: 60,
  },
  "companies-house-search": {
    limit: 20,
    windowSeconds: 60,
  },
  "quote-pdf": {
    limit: 20,
    windowSeconds: 60,
  },
  "contract-pdf": {
    limit: 20,
    windowSeconds: 60,
  },
  "accept-quote": {
    limit: 20,
    windowSeconds: 60,
  },
  "sign-contract": {
    limit: 20,
    windowSeconds: 60,
  },
} as const;

export type RouteKey = keyof typeof RATE_LIMIT_CONFIG;
