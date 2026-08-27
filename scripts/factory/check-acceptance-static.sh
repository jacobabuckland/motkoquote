#!/usr/bin/env bash
#
# An acceptance test must assert behaviour, not the text of the source.
#
#   scripts/factory/check-acceptance-static.sh <acceptance-test>
#
# WHY. AGENTS.md forbids asserting on source text under "Never assert on source
# text". Five acceptance tests did it anyway across #351, #356 and #359 in two
# days, and each cost a full factory cycle. The rule existed; nothing enforced
# it, and an acceptance test is frozen the moment the PM commits it — so by the
# time anyone downstream notices, nobody is permitted to fix it.
#
# The cost is not the wasted cycle. It is that production code ends up shaped by
# regexes: src/app/settings/page.tsx carries a namespace import purely so an
# indexOf finds the right occurrence, and the comment explaining that has to
# avoid spelling the component's own name, because the test matches prose too.
# None of it is behaviour a user can perceive.
#
# Two findings, one scan:
#
#   ::source-text-read::   the test reads a file under src/
#   ::test-file-import::   the test imports another test file
#
# The second is here rather than on its own item deliberately. It is the same
# static scan of the same file at the same moment, and two items each adding a
# rule to one script is an ordering constraint nobody writes down.
#
# Pure: one file path in, a verdict out. No network and the test is never
# executed, so the rules are exercised by fixtures rather than only in anger.
set -euo pipefail

TESTS="${1:-}"

die() { echo "check-acceptance-static: $1" >&2; exit 2; }

[ -n "$TESTS" ] || die "usage: check-acceptance-static.sh <acceptance-test>"
[ -f "$TESTS" ] || die "acceptance test '$TESTS' not found"

# Standing registries that legitimately walk src/.
#
# AGENTS.md blesses both by name as registries with an intended registration
# path, and "never resolve a registry failure by moving the thing being
# registered out of its view" applies with equal force to the registry itself.
#
# Exact paths, never a pattern. A glob such as tests/acceptance/*registry* would
# let the sixth instance name itself around the check. If this list ever grows
# past three or four entries the rule is wrong and should be revisited rather
# than extended — the same discipline as the `exclude` list in vitest.config.ts,
# which names its two entries and explains both.
ALLOWLIST=(
  # Walks src/app/ to assert every public API route is declared. #99.
  "tests/acceptance/99.test.ts"
  # Walks src/app/ to assert every authenticated route has a loading.tsx. #200.
  "tests/acceptance/200.test.tsx"
)

NORMALISED="${TESTS#./}"
for ALLOWED in "${ALLOWLIST[@]}"; do
  if [ "$NORMALISED" = "$ALLOWED" ]; then
    echo "allowlisted=$ALLOWED"
    echo "clean"
    exit 0
  fi
done

FAILED=0

# Both findings are reported, never just the first. Stopping at one costs a
# second cycle to surface the other, and the whole point of this check is that a
# cycle here is expensive.

# 1. Reading source under src/.
#
# Detected as a read call ANYWHERE in the file plus a src/ path ANYWHERE in the
# file, rather than both on one line. The single-line form was the first thing
# written here and it missed three of the five instances this check exists for,
# because the path is routinely built a line or more above the read:
#
#     const componentPath = resolve(process.cwd(), "src/app/settings/foo.tsx");
#     const source = readFileSync(componentPath, "utf-8");
#
# #306, #351 and #356 all take that shape. A matcher that only sees the joined
# form catches the careless half of the problem and misses the tidy half, which
# is the wrong half to miss.
#
# The widened rule fires on a test that reads a fixture and merely mentions a
# src/ path in a comment. That is the deliberate direction. A shell scanner
# cannot parse TypeScript, and the asymmetry decides it: a false positive costs
# one PM re-run with a visible message, a false negative costs a frozen test
# forever. #306 was itself burned by a regex counting a value inside a comment,
# so the limitation is known and accepted rather than overlooked — the escape
# hatch is the allowlist above, which is a reviewed diff.
READ_CALLS=$(grep -nE '\b(readFileSync|readFile)\s*\(' "$TESTS" || true)
SRC_PATHS=$(grep -nE '["'"'"']src/[^"'"'"']*\.(ts|tsx|js|jsx|css|json)["'"'"']' "$TESTS" || true)

if [ -n "$READ_CALLS" ] && [ -n "$SRC_PATHS" ]; then
  echo "::source-text-read::"
  echo "  reads a file:"
  echo "$READ_CALLS" | sed 's/^/    /'
  echo "  names a path under src/:"
  echo "$SRC_PATHS" | sed 's/^/    /'
  FAILED=1
fi

# 2. Importing another test file.
#
# Matched on a static `import` or a dynamic `import()` whose specifier contains
# tests/ or ends .test, .test.ts or .test.tsx. Importing a test file executes
# that suite inside this one, and the path forms that look right mostly are not:
# #352's re-derive froze
#
#     await import("@/../../tests/regression/signup-referral-field.test")
#
# which does not resolve and took the whole acceptance file down with it. The
# gate reported 1 failed | 202 passed test FILES with zero failing tests, which
# is what a file that cannot be imported looks like.
TEST_IMPORTS=$(grep -nE "(^|[^A-Za-z0-9_])import\b[^\"']*[\"'][^\"']*(tests/|\.test(\.tsx?)?)[\"']" "$TESTS" || true)
if [ -n "$TEST_IMPORTS" ]; then
  echo "::test-file-import::"
  echo "$TEST_IMPORTS" | sed 's/^/  /'
  FAILED=1
fi

if [ "$FAILED" = "1" ]; then
  echo "not-clean"
  exit 1
fi

echo "clean"
