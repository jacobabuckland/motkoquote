#!/usr/bin/env bash
#
# If the spec describes something runnable, the acceptance tests must run it.
#
#   scripts/factory/check-deliverable.sh <spec.md> <acceptance-test>
#
# WHY. Two money backfills shipped as library functions with no entry point.
# Every gate passed: the tests were green, the types checked, the review read
# well — and the deliverable could not be run. A migration is live on production
# with no caller because of it.
#
# That is not a coordination bug and no amount of reconciling finds it. It is a
# missing acceptance-criterion class: nothing anywhere asserted that the thing
# the spec described could be invoked. A test that imports a library function and
# asserts its return value is satisfied by a library function, which is exactly
# what got built.
#
# So the PM declares the entry point in the spec:
#
#     RUNNABLE: npx tsx scripts/backfill/recover-over-waived-fees.ts --contractor X
#
# and this refuses to let the item through unless the acceptance test both names
# that entry point and actually invokes something. A spec that says "a script
# that can be run with --contractor X" must produce a test that runs it.
#
# Pure: two file paths in, a verdict out. No network, so the rule is exercised
# by tests rather than only in anger.
set -euo pipefail

SPEC="${1:-}"
TESTS="${2:-}"

die() { echo "check-deliverable: $1" >&2; exit 2; }

[ -f "$SPEC" ]  || die "spec file '$SPEC' not found"
[ -f "$TESTS" ] || die "acceptance test '$TESTS' not found"

# Lenient about markdown decoration, the same way the AMBIGUOUS: check is: an
# agent writing markdown reaches for **RUNNABLE:** or `## RUNNABLE:` and
# treating correct behaviour as a malfunction over a bold marker costs a cycle.
RUNNABLE=$(grep -iE '^[[:space:]>*_#`]*RUNNABLE:' "$SPEC" | head -1 | sed -E 's/^[[:space:]>*_#`]*[Rr][Uu][Nn][Nn][Aa][Bb][Ll][Ee]:[[:space:]]*//; s/[`*_]+$//' || true)

if [ -z "$RUNNABLE" ]; then
  echo "no-entry-point"
  echo "The spec declares no RUNNABLE: entry point, so there is nothing to invoke end to end."
  exit 0
fi

echo "declared=$RUNNABLE"

# The entry point is the first path-shaped token in the command. `npx tsx
# scripts/x.ts --flag` yields scripts/x.ts; a bare `npm run backfill` yields
# nothing path-shaped, which is reported rather than guessed at.
ENTRY=$(printf '%s' "$RUNNABLE" | tr ' ' '\n' \
          | grep -E '^[A-Za-z0-9_./-]+\.(ts|tsx|js|mjs|sh)$' | head -1 || true)

if [ -z "$ENTRY" ]; then
  echo "unresolved-entry-point"
  echo "Could not read a file path out of the declared command, so what the test should invoke cannot be checked mechanically:"
  echo "  $RUNNABLE"
  exit 0
fi

echo "entry=$ENTRY"

FAILED=0

if ! grep -qF "$ENTRY" "$TESTS"; then
  echo "::missing-reference::$ENTRY"
  FAILED=1
fi

# Naming the path is not running it. A test can reference a script in a comment
# or an existsSync assertion and still never execute a line of it — which is the
# shape that let two backfills ship without an entry point at all.
if ! grep -qE 'execFile|execFileSync|execSync|spawnSync|spawn\(|\$\(|child_process' "$TESTS"; then
  echo "::missing-invocation::"
  FAILED=1
fi

if [ "$FAILED" = "1" ]; then
  echo "not-invoked"
  exit 1
fi

echo "invoked"
