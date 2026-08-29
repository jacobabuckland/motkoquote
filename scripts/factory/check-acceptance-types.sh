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
# THE SPLIT, part one. TS2307 — "Cannot find module" — is the legitimate failing-first
# case and is dropped. Everything else is a real type error in a file that is
# about to be frozen, and is reported. Dropping TS2307 loses nothing: an
# unresolved specifier that is NOT a file the spec declares it is creating is
# already caught by check-acceptance-run.sh, which is the check that owns that
# question.

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

# Drop the failing-first case.
# THE SPLIT, part two, and the reason this check nearly became useless.
#
# TS2307 covers a test importing a module that does not exist yet. It does NOT
# cover a test importing an export that does not exist yet FROM A MODULE THAT
# DOES. That produces:
#
#   TS2339: Property 'formatWhatsLeftResponse' does not exist on type
#           'typeof import(".../ledger-query-prompt")'
#
# which is exactly as legitimate: the Engineer is about to add that export. The
# first version of this check dropped only TS2307 and so blocked #403's fifth
# derivation on eleven of those — a correct test, refused. Adding an export to
# an existing file is at least as common as creating a new one, so that made the
# check a throughput problem rather than a safety one.
#
# The discriminator is the TYPE the property is missing from. `typeof import(…)`
# is a module namespace, so the property is an export that does not exist yet.
# Anything else is a real type error and is still reported — including
# `Property 'total' does not exist on type 'number'`, which is a test written
# against the wrong signature and is precisely what this check is for.
REAL="$(printf '%s\n' "$MINE" \
  | grep -v 'error TS2307:' \
  | grep -vE "error TS2339: Property '[^']*' does not exist on type 'typeof import\(" \
  | sed '/^$/d' || true)"

if [ -z "$REAL" ]; then
  echo "check-acceptance-types: no type errors in $TESTS (unresolved-module errors ignored, as intended)."
  exit 0
fi

echo "::error::Acceptance tests for $TESTS contain type errors that are not unresolved imports."
printf '%s\n' "$REAL"
exit 1
