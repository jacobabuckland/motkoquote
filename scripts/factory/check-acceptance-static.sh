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
#
# Two further spellings were added after #599 and #601 each froze a test that
# walked straight through the version above, in the same cycle:
#
#   SHELLING OUT. #599 froze
#
#     execSync('git grep -l "createStripePayment(" -- "src/"')
#
#   which is a source read performed by git rather than by node. `execSync` is
#   NOT banned outright — AGENTS.md requires a RUNNABLE deliverable's tests to
#   invoke its entry point end to end, and those shell out legitimately. The
#   conjunction is what decides it: shelling out AND naming src/. A RUNNABLE
#   test invokes `npx tsx scripts/...`, so it does not trip.
#
#   SPLIT PATH SEGMENTS. #601 froze
#
#     path.join(process.cwd(), "src", "lib", "referral-signup.ts")
#
#   which the old SRC_PATHS could not see: it required `src/` and a file
#   extension inside ONE quoted string, and here every segment is its own
#   string. So the path matcher now also accepts a lone "src" segment and a
#   bare "src/" directory, extension or not.
#
#   A lone "src" is only read as a path segment where a path would put it —
#   after a comma in an argument list, or alone on a continuation line. Not
#   every "src" in a test file is a directory: `script.getAttribute("src")` is
#   the HTML attribute, and #196 (which reads native/www/, never src/) is a
#   clean test that the first draft of this rule failed. Bracketing on the
#   preceding comma separates the two without a parser.
READ_CALLS=$(grep -nE '\b(readFileSync|readFile|readdirSync|readdir|globSync|execSync|execFileSync|spawnSync)\s*\(' "$TESTS" || true)
SRC_PATHS=$(grep -nE '["'"'"'](\./)?src/[^"'"'"']*["'"'"']|,[[:space:]]*["'"'"']src["'"'"']|^[[:space:]]*["'"'"']src["'"'"'][[:space:]]*,' "$TESTS" || true)

# The SAME finding reached by a different syntax. A `?raw` import hands back the
# file's text exactly as readFileSync does — the bundler performs the read
# instead of node, and neither matcher above sees it: it is not a read CALL, and
# the specifier is `@/app/...` rather than `src/...`.
#
# #582 froze two of these and cost three QA cycles. One of them was strictly
# weaker than the behavioural form it replaced: inverting the page's branch so
# the empty state rendered OVER a non-empty list — a real, user-visible bug with
# both grepped strings still present — left all 25 assertions passing.
#
#     const source = await import("@/app/jobs/archived/page?raw");
#     expect(source.default).toContain("Nothing archived");
#
# `@/` maps to `src/`, so anything under it is source by definition. A `?raw`
# read of a MIGRATION is legitimate and common here — seven shipped acceptance
# tests do it — so the rule keys on the path being source, not on `?raw` alone.
#
# `@/..` climbs out of src/ and is therefore never a source read; it is already
# reported by rule 3 as dead, and is filtered here so one fault is not named
# twice under two different findings.
RAW_SOURCE_IMPORTS=$(grep -nE '["'"'"'][^"'"'"']*(@/|src/)[^"'"'"']*\?raw["'"'"']' "$TESTS" \
  | grep -v '@/\.\.' || true)

if { [ -n "$READ_CALLS" ] && [ -n "$SRC_PATHS" ]; } || [ -n "$RAW_SOURCE_IMPORTS" ]; then
  echo "::source-text-read::"
  if [ -n "$READ_CALLS" ] && [ -n "$SRC_PATHS" ]; then
    echo "  reads a file:"
    echo "$READ_CALLS" | sed 's/^/    /'
    echo "  names a path under src/:"
    echo "$SRC_PATHS" | sed 's/^/    /'
  fi
  if [ -n "$RAW_SOURCE_IMPORTS" ]; then
    echo "  imports source text with ?raw:"
    echo "$RAW_SOURCE_IMPORTS" | sed 's/^/    /'
  fi
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

# 3. An import specifier that climbs out of the repository.
#
# `@/*` maps to `./src/*` (tsconfig.json), so `@/../..` resolves one level ABOVE
# the repository root and can never name a file in this project. It is always
# dead, whatever follows it.
#
# Both instances of this cost a full cycle. #352 froze
#
#     await import("@/../../tests/regression/signup-referral-field.test")
#
# and #475's fourth derivation froze
#
#     await import("@/../../supabase/migrations/00000000000054_...sql?raw")
#
# which failed with ENOENT on '/home/user/supabase/...' — outside the checkout.
# The first is caught by rule 2 because it names a test file; the second is not,
# because reading a migration is legitimate and common here. Seven shipped
# acceptance tests read migration text via join(process.cwd(), "supabase/
# migrations"), which resolves correctly. So the fault is not the migration —
# it is the path form, and that is what this rule names.
#
# Deliberately narrow: `@/..` alone reaches the repository root and can resolve,
# so only the second climb is reported. No false positive is possible, because
# no file above the checkout is ever a legitimate target.
ESCAPING_IMPORTS=$(grep -nE '["'"'"']@/\.\./\.\.' "$TESTS" || true)
if [ -n "$ESCAPING_IMPORTS" ]; then
  echo "::path-escapes-repo::"
  echo "  @/ maps to src/, so @/../.. is above the repository root and cannot resolve:"
  echo "$ESCAPING_IMPORTS" | sed 's/^/    /'
  FAILED=1
fi

if [ "$FAILED" = "1" ]; then
  echo "not-clean"
  exit 1
fi

echo "clean"
