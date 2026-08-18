#!/usr/bin/env bash
#
# Name the file that actually failed, or say that it could not be identified.
#
#   scripts/factory/attribute-failure.sh <failing-log>
#
# Prints, on stdout:
#   source=<path>      a file the log identifies AS FAILING (zero or more)
#   frozen=<path>      of those, the ones the Engineer may not edit
#   unidentified       when no failing source could be parsed at all
#
# WHY. The check this replaces grepped the whole failing log for any
# `tests/acceptance/` path and named what it found as the cause. On #244 it
# named five frozen contracts — 101, 106, 108, 113, 115 — none of which had
# failed, and the real failure was in tests/regression/. Following it would have
# sent someone to hand-patch five innocent files.
#
# The mechanism is worth recording, because it is a trap anyone would fall into:
# it TRIED to exclude passing lines with `grep -vE '^[[:space:]]*(FAIL|✓|…)'`,
# but vitest prefixes those markers with ANSI colour codes, so the marker is
# never at the start of the line and the exclusion matched nothing. Every
# PASSING file in the log was harvested, then `head -5` took the first five
# alphabetically. Reading the log is not enough if you read it credulously.
#
# The rule now: a file may only be named if the log identifies it as the subject
# of a failure — a vitest FAIL line, a tsc diagnostic, or an ESLint block with an
# error in it. A mention anywhere else is not evidence.
set -uo pipefail

LOG="${1:-}"
if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
  echo "unidentified"
  echo "no-log"
  exit 0
fi

# Normalise before parsing. GitHub prefixes every line with a timestamp, and
# vitest wraps its markers in colour codes — both of which defeat anchored
# patterns, which is exactly how the previous version failed.
NORMALISED=$(mktemp)
sed -E -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' \
       -e 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z[[:space:]]?//' \
       -e 's/^[^\t]*\t[^\t]*\t//' "$LOG" > "$NORMALISED"

{
  # vitest: " FAIL  path/to/file.test.ts > describe > it"
  # The subject is the token after FAIL, up to the first " > ".
  grep -aE '^[[:space:]]*FAIL[[:space:]]' "$NORMALISED" \
    | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//; s/[[:space:]]*>.*$//' \
    | sed -E 's/[[:space:]]+$//'

  # tsc: "path/to/file.ts(214,38): error TS2345: ..."
  grep -aE '^[^[:space:]()]+\([0-9]+,[0-9]+\): error TS[0-9]+' "$NORMALISED" \
    | sed -E 's/\([0-9]+,[0-9]+\): error TS[0-9]+.*$//'

  # ESLint: a bare path, then indented "  12:3  error  ..." lines beneath it.
  # Only the paths that actually have an error under them, not warnings.
  awk '
    /^\/?[A-Za-z0-9._\/-]+\.(ts|tsx|js|jsx|mjs|cjs)$/ { current = $0; next }
    /^[[:space:]]+[0-9]+:[0-9]+[[:space:]]+error[[:space:]]/ {
      if (current != "") { print current; current = "" }
    }
  ' "$NORMALISED"
} | sed -E 's#^\./##; s#^.*/motkoquote/##' | sort -u | grep -a . > "$NORMALISED.sources" || true

rm -f "$NORMALISED"

if [ ! -s "$NORMALISED.sources" ]; then
  rm -f "$NORMALISED.sources"
  echo "unidentified"
  exit 0
fi

while IFS= read -r src; do
  echo "source=$src"
done < "$NORMALISED.sources"

# Of the files that actually failed, the ones the Engineer may not edit. Frozen
# paths that merely appear in the log are not reported, which is the whole fix.
grep -aE '^(tests/acceptance/|docs/specs/)' "$NORMALISED.sources" \
  | while IFS= read -r frozen; do
      echo "frozen=$frozen"
    done

rm -f "$NORMALISED.sources"
