#!/usr/bin/env bash
#
# Type-check a PM's acceptance test, WITHOUT breaking the failing-first contract.
#
#   scripts/factory/check-acceptance-types.sh <tests-file> [tsc-log]
#
# With no log, it runs `tsc --noEmit` itself. With one, it reads that instead —
# the same shape as check-acceptance-run.sh, and for the same reason: the rule
# is then exercisable by fixture in under a second, rather than only by a
# twenty-second compile of the whole tree.
#
# WHY THIS EXISTS, and why the PM step above it lints rather than typechecks.
#
# A correct acceptance test describes a world that does not exist yet: it
# imports the module the Engineer is about to create. Requiring the whole file
# to typecheck at spec time makes that impossible and permits only tests that
# import nothing new — the opposite of the contract this pipeline runs on. #152
# was blocked by exactly that, on a test that was correct:
#
#   TS2307: Cannot find module '@/lib/payment-reassurance-copy'
#
# So the lint step's comment concludes that genuine type errors "surface at the
# gate once the modules are real, and are corrected by amending the branch's
# first commit". That remedy is real but it is MANUAL: amending the first commit
# rewrites history, and nothing in this pipeline force-pushes. In practice every
# such error costs a full re-derivation, and the item carries a frozen test
# nobody downstream may repair in the meantime.
#
# #403 paid for it. Its acceptance file RAN GREEN — 22 tests passing — and still
# could not merge:
#
#   tests/acceptance/403.test.ts(296,57): error TS2554: Expected 0 arguments, but got 1.
#
# `vi.fn(async () => ({ … }))` infers a zero-argument function, so calling the
# mock with an argument is a type error. AGENTS.md warns about this trap by
# name. Nothing caught it: eslint does not type-check, and vitest does not care,
# because at runtime the argument is simply ignored.
#
# WHAT THIS REPORTS. Only diagnostics the test itself creates and no
# implementation can resolve — see the allowlist below. Everything else is
# silence, because a correct acceptance test describes code that does not exist
# yet and can therefore produce almost any type error legitimately.

set -uo pipefail

TESTS="${1:?usage: check-acceptance-types.sh <tests-file> [tsc-log]}"
LOG="${2:-}"

if [ ! -f "$TESTS" ]; then
  echo "check-acceptance-types: acceptance test '$TESTS' not found" >&2
  exit 2
fi

if [ -n "$LOG" ]; then
  if [ ! -f "$LOG" ]; then
    echo "check-acceptance-types: tsc log '$LOG' not found" >&2
    exit 2
  fi
  RAW="$(cat "$LOG")"
else
  RAW="$(npx tsc --noEmit 2>&1 || true)"
fi

# Diagnostics for THIS file only. A pre-existing error elsewhere in the tree is
# not this item's to answer for, and blocking on one would make every item wait
# for an unrelated fix.
MINE="$(printf '%s\n' "$RAW" | grep -F "$TESTS(" || true)"

# AN ALLOWLIST, NOT A DENYLIST — and the reason the first two attempts failed.
#
# The original rule was "report everything except TS2307". Then "except TS2307
# and TS2339 on a module namespace". Both were wrong in the same way: they tried
# to enumerate what a correct failing-first test looks like, and a correct
# failing-first test can produce ALMOST ANY diagnostic, because the whole point
# is that the code it describes does not exist yet.
#
# #403 proved it three times over. Its acceptance test was refused for:
#
#   TS2339: Property 'formatWhatsLeftResponse' does not exist on type
#           'typeof import(".../ledger-query-prompt")'    — export not written yet
#   TS2339: Property 'total' does not exist on type 'number'
#
# The second one looks like a test written against the wrong type, and the
# earlier version of this file said so in a comment. It is not. That item CHANGES
# getWhatsLeft from Promise<number> to Promise<WhatsLeftAnswer>, so until the
# implementation lands, `(await getWhatsLeft()).total` is exactly the assertion
# the item exists to make — and tsc is exactly as entitled to complain about it.
# Any item that changes an existing signature produces that shape.
#
# So the question is not "is this diagnostic on the failing-first list". It is
# "could a correct test produce this even though the implementation is absent".
# Where the answer is yes, this check must stay silent, because it cannot tell a
# correct test from an incorrect one and a false block costs the item a cycle.
#
# That leaves a small allowlist: diagnostics about something the TEST ITSELF
# declares, which no implementation can change.
#
#   TS2554  "Expected 0 arguments, but got M" or "Expected N arguments, but
#           got 0" — a mock whose signature the test wrote, contradicted by the
#           test's own call. `vi.fn(async () => …)` infers zero arguments (#403);
#           `vi.fn(async (_id: string) => …)` requires one, so calling it with
#           none fails in the opposite direction (#438). Both are the test
#           against itself, and no Engineer can make either pass.
#
# NOT every TS2554. This check used to grep the bare code, and that was a false
# positive on the exact thing the factory asks acceptance tests to be.
#
# An item whose job is to give a function a new parameter has a correct
# failing-first test that calls it with the new arity. Against the CURRENT
# signature that is:
#
#   error TS2554: Expected 1 arguments, but got 2.
#
# PFIX-2 (#528) is precisely that item — `extractStatedPrices(transcript)` takes
# one parameter and the whole ticket is to hand it the speaker-labelled turns as
# a second. Ten errors of that shape were reported as the zero-argument mock
# trap, twice, under a fixed narrative naming `vi.fn` — which appears nowhere in
# the failure. PFIX-4 (#529) was blocked by the same misreading. Both were
# correct and both were told they were self-contradicting.
#
# The discriminator is the ZERO on one side. A test that calls a real function
# with more arguments than it currently takes is describing code that does not
# exist yet, which is the entire point. A test that calls something with zero
# arguments when it needs some, or with some when it takes zero, is contradicting
# a signature it wrote itself — nothing on the roadmap turns a real function into
# a zero-parameter one.
#
# Adding to this list is a reviewed decision, and the bar is: a correct
# failing-first test could never produce it. `Expected N, but got M` with both
# sides non-zero does not clear that bar. It never did.
REAL="$(printf '%s\n' "$MINE" | grep -E 'error TS2554: Expected (0 arguments, but got [1-9]|[1-9][0-9]* arguments?, but got 0)' | sed '/^$/d' || true)"

if [ -z "$REAL" ]; then
  echo "check-acceptance-types: no self-contradicting type errors in $TESTS (diagnostics a correct failing-first test could produce are ignored, as intended)."
  exit 0
fi

echo "::error::Acceptance tests for $TESTS contain type errors no implementation can resolve — the test contradicts a signature it wrote itself."
printf '%s\n' "$REAL"
exit 1
