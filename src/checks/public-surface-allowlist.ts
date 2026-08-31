import type { AllowedExposure } from "./public-surface-core";

/**
 * SECURITY DEFINER functions that are reachable without the service role, and
 * are tolerated anyway.
 *
 * It is empty, and that is the intended steady state. Migration 55 revoked the
 * two entries this list was created with — `settle_fee_collection` and
 * `check_public_tables_rls` — rather than accepting them, so there is nothing
 * left to excuse.
 *
 * READ THIS BEFORE ADDING AN ENTRY.
 *
 * Every entry here is a function that runs as its owner with RLS bypassed, and
 * that anyone holding the publishable key can call over HTTP. The publishable
 * key ships in the browser bundle, so `anon` means "the internet".
 *
 * Adding an entry is a `DECISION NEEDED`-equivalent notice, by the same rule
 * AGENTS.md sets for the public-route registry in `tests/acceptance/99.test.ts`:
 * a human must see the unauthenticated surface, because that is the entire
 * purpose of the check firing. **Never add an entry to make a red check green.**
 * The check going red means production changed, and the question is whether
 * production should be that way — not whether this list should.
 *
 * The alternative to an entry is one statement, and it is almost always the
 * right one:
 *
 *     REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM anon, authenticated, PUBLIC;
 *
 * That is what migration 55 does. Prefer it. A revoked function is one fewer
 * thing on this list, and this list is most useful at zero.
 */
export const ALLOWED_EXPOSURES: AllowedExposure[] = [];
