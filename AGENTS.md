<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing conventions

## DOM test environment

The global vitest config defaults to `environment: "node"` for performance and compatibility with the existing test suite. Tests that need DOM access (rendering components, firing user interactions, testing browser APIs) opt in **per-file** via a directive at the top of the test file:

```tsx
/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
// ... your test code
```

The `happy-dom` library provides a fast, lightweight DOM implementation for testing. Do **not** migrate existing node-environment tests to DOM unless they actually need it — DOM environments are slower and add unnecessary overhead for tests that don't interact with the DOM.

## Capacitor mocking

All Capacitor plugin mocking should use the shared helpers in `tests/helpers/capacitor.ts`. Do **not** write custom `vi.mock()` calls for Capacitor plugins in individual test files — this ensures consistency and prevents incompatible mocking approaches.

### Usage

```tsx
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

describe("My feature", () => {
  it("calls Haptics on native platform", () => {
    // Mock as native (pass true)
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();

    // Your code that uses Capacitor plugins
    mocks.Haptics.impact({ style: "medium" });

    // Assert the plugin was called
    const calls = mocks.Haptics.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("impact");
    expect(calls[0].args[0]).toEqual({ style: "medium" });
  });

  it("skips native features on web platform", () => {
    // Default is web (pass false or omit the argument)
    mockNativePlatform(false);
    const mocks = mockCapacitorPlugins();

    // Your code that guards native features
    // if (Capacitor.isNativePlatform()) { ... }

    // Assert the plugin was never called
    expect(mocks.Haptics.getCalls()).toHaveLength(0);
  });
});
```

### Key points

- **Default is web platform** (`isNativePlatform()` returns `false`) so tests that don't explicitly opt into native mode behave exactly as they do today.
- Only the five installed plugins are mocked: `@capacitor/app`, `@capacitor/haptics`, `@capacitor/push-notifications`, `@capacitor/share`, `@capacitor/splash-screen`.
- Call records reset automatically between tests via `beforeEach` — one test's calls cannot satisfy another's assertions.
- Each plugin mock has a `getCalls()` method that returns an array of `{method: string, args: any[]}` objects for assertion.

## Acceptance tests must pass lint and typecheck

`tsc` and ESLint both cover `tests/`. A test file that fails either is not a
tidiness problem: acceptance tests are frozen once the PM commits them, so
nothing downstream is permitted to repair one, and the item blocks for good.

"Frozen" means the acceptance tests written for the ticket you are on. A
standing registry or inventory that ships with an intended registration path —
the public-API-route list in `tests/acceptance/99.test.ts` is the one to know —
is not frozen, and adding an entry through that path is registration, not
repair. Never resolve a registry failure by moving the thing being registered
out of its view; a route that stops being seen is worse than one that fails the
check. Adding an entry to a security registry is a `DECISION NEEDED`-equivalent
notice in the triage digest — a human sees the unauthenticated surface, and
that is the whole point of the check firing.

A signal that must change behaviour cannot terminate in telemetry. If a
computed check needs to reach a human or gate an action, it must be routed to a
surface that does so. Writing it to an events or analytics sink is not
delivery, whether or not that sink is working.

Run both against your test file before you finish:

```bash
npx eslint tests/acceptance/<issue>.test.tsx
npm run typecheck
```

Two rules bite constantly and are errors here, not warnings:

- **Never name a variable `module`.** `@next/next/no-assign-module-variable`
  rejects it, and `const module = await import("@/…")` is the phrasing that
  comes naturally when asserting a file exists. Use `mod` or `imported`:

  ```ts
  const mod = await import("@/app/q/[id]/loading");
  expect(mod.default).toBeDefined();
  ```

- **Never use `any`.** `@typescript-eslint/no-explicit-any` is an error. Reach
  for `unknown` and narrow, or write the shape out.

Mock signatures need declaring rather than inferring, too: `vi.fn(async () =>
null)` infers `Promise<null>`, so a later `mockResolvedValue({ … })` is a type
error, and a zero-argument mock makes `mock.calls[0][0]` unreachable.

## Testing a component that rotates on a timer

Two mistakes here have each cost an entire item, not a lint error. Both produce
a frozen acceptance test that **no implementation can pass**, and a frozen test
cannot be repaired downstream — so the item blocks for good. #269 hit both, on
consecutive derivations.

- **Never pair `vi.useFakeTimers()` with `await waitFor(...)`.** Testing
  Library's `waitFor` polls on its own timers, which the fake clock also
  freezes, so it never re-checks and never resolves — the test hangs until the
  5s default kills it. This happens whatever is rendered: a bare
  `<p>Loading</p>` whose assertion is already true on the first poll still
  deadlocks.

- **Never call `vi.runAllTimersAsync()` on a component with a perpetual
  `setInterval`.** It runs pending timers recursively and a repeating interval
  never drains, so it aborts with *"Aborting after running 10000 timers"*. The
  only way to satisfy it is a self-terminating counter in the component, which
  is test-only logic in production code — and it still fails, because the
  interval exhausts to one fixed index and every later observation is
  identical.

Rotation is deterministic, so there is nothing to wait *for*. Advance the clock
and assert synchronously:

```tsx
vi.useFakeTimers();
render(<AppLoadingScreen />);

expect(screen.getByText("Loading your quotes")).toBeDefined();

act(() => {
  vi.advanceTimersByTime(2000);
});

expect(screen.getByText("Loading your contracts")).toBeDefined();

vi.useRealTimers();
```

Assert the message the component should be showing, rather than collecting a
`Set` of whatever appears and counting it. A count over observations says
nothing about which message was shown when, and it is the shape that produced
both failures above.

## A runnable deliverable must be run by its acceptance tests

If a spec describes something **runnable** — a script, a command, a cron job,
anything a person or a scheduler invokes — it carries a line reading exactly:

```
RUNNABLE: npx tsx scripts/backfill/recover-over-waived-fees.ts --contractor X
```

and the acceptance tests must invoke that command **end to end**, not merely
import the function behind it. `scripts/factory/check-deliverable.sh` enforces
it at spec time, and the PM run blocks if the tests name no entry point or never
invoke anything at all.

This exists because two money backfills shipped as library functions with no
entry point. Every gate passed — tests green, types clean, review positive — and
the deliverable could not be run. A migration is live on production with no
caller because of it.

It is a missing acceptance-criterion class rather than a bug in any one item. A
test that imports a function and asserts its return value is *satisfied* by a
library function, so that is what gets built; nothing anywhere asked whether the
thing the spec promised could be invoked. Naming the script in an `existsSync`
assertion does not count — that is a test about a file, not about a deliverable.

Omit the line entirely when the item is not runnable: a component, a guard, a
schema change. Do not invent an entry point the item does not call for.

## Rendering React components

A DOM environment on its own only gives you `document` — it does not let you
mount a component. Rendering a real component from `src/` uses
`@testing-library/react`, in a file that has opted into `happy-dom`:

```tsx
/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

// Required. The vitest config does not set `globals: true`, so Testing
// Library's automatic cleanup never registers itself, and without this each
// test's markup stays in document.body for the next test's query to find.
afterEach(cleanup);

describe("Button", () => {
  it("fires its handler when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send quote</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Send quote" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

Query by accessible role and name (`getByRole("button", { name: … })`) rather
than by class name or test id, so the assertion describes what a user can
perceive and does not break when styling changes.

### When to use which environment

- **Node environment** (default): Pure logic tests, utility functions, server-side code, API routes, anything that doesn't interact with the DOM or render components.
- **DOM environment** (opt-in via `@vitest-environment happy-dom`): Component rendering, user interaction simulation, browser API testing, anything that needs `document`, `window`, or DOM manipulation.

Worked examples: `tests/examples/component-render.test.tsx` renders a real
component and asserts an interaction; `tests/examples/dom-capacitor.test.tsx`
covers the DOM environment and the Capacitor native/web paths.

# Database access

Agent sessions have **read-only** access to production via the `agent_readonly`
role (`supabase/migrations/00000000000044_agent_readonly_role.sql`).

**What it can reach — four tables, `select` only:**

| Table | Why |
|---|---|
| `jobs` | `transcript`, `conversation_json`, `sow_json` — the voice diagnostic |
| `quotes` | the payload to classify the transcript against |
| `contracts` | downstream state |
| `invoices` | downstream state |

**What it cannot reach, deliberately:** every other table — including
`push_subscriptions` (APNs device tokens, VAPID keys), `contractors`,
`customers`, `team_members`, `rate_cards`, `knowledge_chunks` — and the
`auth`, `storage` and `vault` schemas entirely.

**Write access is absent by construction.** The role holds `select` and nothing
else, so an insert, update or delete is refused by the database itself, not by
convention. Do not look for a guard in application code — there isn't one, and
there doesn't need to be. Never ask for write access to run a fix: production
mutations, migrations and backfills are applied by a human via
`supabase db push`, as they always have been.

**This role reads real customer PII.** `jobs.transcript`, `conversation_json`
and `sow_json` carry the customer's name, site address, phone and email as
captured during intake; `contracts` carries `signer_name`. That exposure was
known and authorised (see `areas/motko.md`, 2026-08-21). Quote what a diagnosis
needs and no more — never paste a whole transcript into an issue, a PR
description, or a commit message.

**Why it exists:** classifying a stored transcript against the resulting
payload — stated / asked-answered-discarded / never asked / invented — is the
fastest way to tell an intake defect from an extraction defect, and it is
decisive where reading the prompt is only suggestive. The 21 Aug 2026 voice
investigation could not do it and reached a probabilistic answer where a
definitive one existed in the data.

**When the credential is missing or the query fails**, report a `CAPABILITY
FAULT` naming what you could not reach and the permission you lacked. Two
things are never acceptable: inferring data you could not read, and presenting
an inference as a query result. An empty result set is reported as an empty
result set — never as the absence of the underlying record, which is a
different claim and usually a wrong one.

# Blocking is the exception, not the fallback

A blocked ticket costs a human context switch and stalls the queue for hours. A
wrong reversible decision costs a revert. If you are more often right than
wrong, proceeding is the cheaper policy and is therefore the required one.

**You may not emit `DECISION NEEDED` because you are unsure.** Uncertainty is
not a blocking reason. You may only block if step 5 below produces a match on
the escalation list, or if step 3 fails twice.

## Before you are permitted to block, run this in order

**1. Is the answer already in the ticket?**
Read the whole card, including Out of scope and Behaviour on edge cases. If the
ticket states the answer, act on it. Do not ask permission to follow an
instruction you have already been given.

**2. Is the answer already in `areas/motko.md` or in `AGENTS.md`?**
If a decision has been recorded, it is binding and the question is closed. Act
on it and cite it.

**3. Is this missing information rather than a missing decision?**
If the question would be answered by something you could fetch — a CI log, a
file, a run URL, a query result — then fetch it. Retry once on failure. Then
decide.

A failed retrieval is a fact about the attempt, never a description of the
answer. Do not reason about what a log probably said. Read it.

If retrieval fails twice, escalate as `CAPABILITY FAULT`, naming what you could
not reach and what permission you lacked. This is not a decision request and
must not be phrased as one.

**4. Is this a scheduling or dependency question?**
Not a decision. Return the ticket to the queue with a wake condition (the
branch, PR, or ticket it waits on). Do not build a placeholder for an unmerged
dependency, and do not ask whether to wait.

**5. It is a genuine judgement call. Check the escalation list.**

Escalate to a human — always, regardless of how confident you are:

- **Money.** Fees, pricing, Stripe, payouts, invoice amounts, anything
  affecting what a contractor or customer is charged.
- **Customer-facing legal or contractual copy.**
- **Irreversible writes.** Data migrations, destructive backfills, anything a
  revert does not undo.
- **Auth, permissions, session handling, or public route exposure.**
- **The App Store submission surface**, while a resubmission is open.
- **Anything contradicting a recorded decision.** Do not resolve the conflict.
  Report it.

No match on that list: **decide**. Take your own recommendation, record it, and
proceed. If you had a recommendation, you had the answer — emitting it as a
question and waiting is the failure mode this protocol exists to remove.

That last sentence is not hypothetical. #300 was declared ambiguous by three
separate PM runs. The third one listed four options, recommended option (a),
and blocked — twenty minutes after option (a) had been decided and posted on
the issue. It had the answer twice over and asked anyway.

## When you decide, record it

Append to `areas/motko.md` in the same commit:

```
## 2026-08-21 — <the question, one line>
Decision: <what you chose>
Rationale: <why, two lines maximum>
Ticket: #NNN
Reversible: yes
Precedent: yes/no
```

Set `Precedent: yes` when the decision establishes a pattern later tickets will
copy — an import guard, a naming convention, a storage key shape. Those still
proceed; they are flagged so the reversal cost is visible before four tickets
inherit it.

## Format when you do block

Every block states its type on the first line: `CAPABILITY FAULT`,
`CONTRACT CONFLICT`, or `ESCALATION — <which list item>`.

A block with no type, or one whose type is not among those three, is a protocol
violation. If you find yourself writing "Question:" followed by options and a
recommendation, you have the answer — take it.
