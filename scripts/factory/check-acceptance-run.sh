#!/usr/bin/env bash
#
# Classify what the PM's acceptance-test run actually produced.
#
#   scripts/factory/check-acceptance-run.sh <spec.md> <vitest-log>
#
# WHY. The PM already runs the acceptance file it is about to freeze —
# factory-pm.yml has carried "Acceptance tests must fail before implementation"
# since before any of the incidents this exists for. The defect was never a
# missing run. It was that the step branched on the EXIT CODE alone:
#
#     if npx vitest run "$TESTS"; then
#       # passed against an unmodified tree: block   <- the #315 guard, correct
#     fi
#     echo "Acceptance tests fail before implementation, as required."
#
# Zero is handled. Every non-zero outcome fell through to "as required",
# including a file that could not be loaded at all. That is exactly what #352's
# re-derive was: `import("@/../../tests/regression/signup-referral-field.test")`
# does not resolve, vitest exits non-zero, and the step waved it through. At
# suite scale it reported 1 failed | 202 passed test FILES with ZERO failing
# tests — 2,632 assertions passing, not one of them in the file just frozen.
#
# The run was not missing. The classification was.
#
# A frozen acceptance test cannot be repaired downstream, so this does not cost
# a retry: it costs the item, an Engineer run, a QA run, a human round-trip and
# a full re-derive. #352 burned two complete cycles and went to a third.
#
# Pure: two file paths in, a verdict out. No network, and vitest is never
# invoked from here — the caller runs it and hands over the log — so the rules
# are exercised by fixture logs rather than only in anger.
set -uo pipefail

SPEC="${1:-}"
LOG="${2:-}"

die() { echo "check-acceptance-run: $1" >&2; exit 2; }

[ -n "$SPEC" ] && [ -n "$LOG" ] || die "usage: check-acceptance-run.sh <spec.md> <vitest-log>"
[ -f "$SPEC" ] || die "spec file '$SPEC' not found"
[ -f "$LOG" ]  || die "vitest log '$LOG' not found"

# The "Tests" summary line is the signal. Measured on this tree:
#
#   a test that ran and failed   ->  Tests  1 failed (1)
#   a file that could not load   ->  Tests  no tests
#
# A classifier that cannot find that line must NOT return "fine" — returning
# "fine" on an outcome it did not understand is the defect being fixed, one
# level up.
TESTS_LINE=$(grep -E '^[[:space:]]*Tests[[:space:]]' "$LOG" | tail -1 || true)

if [ -z "$TESTS_LINE" ]; then
  echo "::unreadable-log::"
  echo "No 'Tests' summary line in the log, so what the run did cannot be established."
  exit 1
fi

echo "summary=$(echo "$TESTS_LINE" | sed -E 's/^[[:space:]]*//')"

# --- All passed. -------------------------------------------------------------
#
# Retained behaviour, moved here so every verdict lives in one readable place
# covered by the same fixtures. #315 froze thirty tests that all passed on a
# clean tree: the work was already shipped, and the guard is the only reason two
# more agent runs were not spent rebuilding it.
if echo "$TESTS_LINE" | grep -qE '[0-9]+ passed' && ! echo "$TESTS_LINE" | grep -qE 'failed'; then
  echo "::tests-all-passed::"
  echo "Every test passed against the tree as it stands, so they cannot be testing the behaviour this item asks for."
  exit 1
fi

# --- Something ran and failed. ----------------------------------------------
#
# The expected state for an item that modifies existing behaviour. Pass.
#
# This deliberately does NOT catch a test that runs and fails for the WRONG
# reason — #352's first derive (referral codes normalizeReferralCode rejects)
# and #356 (asserting copy that #351 exists to remove) both ran and failed
# semantically. No exit-code classifier distinguishes those from a correct
# pre-implementation failure, and claiming otherwise would be worse than a
# narrow check, because the next reader would stop looking.
if echo "$TESTS_LINE" | grep -qE '[0-9]+ failed'; then
  echo "ran-and-failed"
  exit 0
fi

# --- Nothing executed. -------------------------------------------------------
#
# "no tests", or a summary reporting neither passes nor failures. The file could
# not be loaded, or loaded and registered nothing (an empty describe, or every
# test skipped) — a frozen file that checks nothing is the same defect with a
# different cause.
#
# EXCEPT where every unresolved specifier is a file the spec declares it is
# creating. This is the distinction that has to be got right rather than
# guessed: an acceptance test for a brand-new component top-level-imports that
# component, so BEFORE implementation it produces the identical "no tests"
# shape. The two are told apart by WHAT failed to resolve, never by the shape of
# the failure.
SPECIFIERS=$(grep -oE "Cannot find (package|module) '[^']*'|Failed to load url [^ ]+" "$LOG" \
             | sed -E "s/^Cannot find (package|module) '//; s/'$//; s|^Failed to load url ||" \
             | sort -u || true)

if [ -z "$SPECIFIERS" ]; then
  echo "::no-tests-executed::"
  echo "Nothing in the file executed, and the log names no unresolved import — so it loaded and registered no tests, or failed in a way this cannot read."
  exit 1
fi

# Every entry the spec's ## Files section marks (new). Tolerates the two forms
# both real specs use: a bare path, and one wrapped in backticks.
DECLARED=$(awk '
  /^##[[:space:]]+Files/       { inside = 1; next }
  inside && /^##[[:space:]]/   { inside = 0 }
  inside && /\(new\)/          { print }
' "$SPEC" \
  | sed -E 's/^[[:space:]]*[-*][[:space:]]*//; s/`//g' \
  | sed -E 's/[[:space:]]*\(new\).*$//' \
  | sed -E 's/[[:space:]]+$//' \
  | grep -E '^[A-Za-z0-9_./-]+$' || true)

UNEXPECTED=""
for SPEC_REF in $SPECIFIERS; do
  # Resolve the "@" alias from vitest.config.ts (@ -> ./src) before comparing,
  # so "@/app/foo/page" can match a Files entry of "src/app/foo/page.tsx".
  RESOLVED="${SPEC_REF#@/}"
  case "$SPEC_REF" in
    @/*) RESOLVED="src/$RESOLVED" ;;
  esac

  # A specifier under tests/ can never be a spec-declared new source file, so
  # #352's case is caught unconditionally and never needs the Files list.
  MATCHED=""
  case "$RESOLVED" in
    */tests/*|tests/*) MATCHED="" ;;
    *)
      for FILE in $DECLARED; do
        # Extensions are tolerated on either side: a spec lists
        # src/lib/foo.ts, the import says @/lib/foo.
        if [ "${RESOLVED%.*}" = "${FILE%.*}" ] || [ "$RESOLVED" = "$FILE" ]; then
          MATCHED="$FILE"
          break
        fi
      done
      ;;
  esac

  if [ -n "$MATCHED" ]; then
    echo "expected-missing=$SPEC_REF (declared new: $MATCHED)"
  else
    UNEXPECTED="$UNEXPECTED $SPEC_REF"
  fi
done

# Pass only if EVERY unresolved specifier is spec-declared. One stray tests/
# import among three legitimate ones still blocks.
if [ -n "$UNEXPECTED" ]; then
  echo "::no-tests-executed::"
  echo "Nothing in the file executed, and these imports are not files this spec declares it is creating:"
  for S in $UNEXPECTED; do echo "  $S"; done
  exit 1
fi

echo "expected-pre-implementation"
exit 0
