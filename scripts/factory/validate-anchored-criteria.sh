#!/usr/bin/env bash
set -euo pipefail

# Usage: validate-anchored-criteria.sh <spec-file> <test-file>
#
# Validates that all acceptance criteria in the spec are anchored to test assertions.
# An anchor is a reference like:
#   → tests/acceptance/N.test.ts: "describe > it"
#   → tests/acceptance/N.test.ts:123
#
# Exits 0 if all criteria are anchored, 1 if any are unanchored.

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spec-file> <test-file>" >&2
  exit 1
fi

SPEC_FILE="$1"
TEST_FILE="$2"

if [ ! -f "$SPEC_FILE" ]; then
  echo "Error: Spec file not found: $SPEC_FILE" >&2
  exit 1
fi

# Extract the "Acceptance criteria" section from the spec
# Look for lines starting with "- " (list items) between "## Acceptance criteria" and the next "##"
CRITERIA=$(awk '
  /^## Acceptance criteria/ { in_section=1; next }
  in_section && /^##/ { exit }
  in_section && /^[[:space:]]*-[[:space:]]/ { print }
' "$SPEC_FILE")

if [ -z "$CRITERIA" ]; then
  # No acceptance criteria section found - that's okay for ambiguous specs
  exit 0
fi

# Check each criterion for an anchor
# Anchor patterns:
#   → tests/acceptance/N.test.ts: "describe > it"
#   → tests/acceptance/N.test.tsx: "describe > it"
#   → tests/acceptance/N.test.ts:123
UNANCHORED=()

while IFS= read -r LINE; do
  # Skip empty lines
  if [ -z "$LINE" ]; then continue; fi

  # Check if the line contains an anchor pattern
  # Pattern 1: → file.test.ts: "test name"
  # Pattern 2: → file.test.ts:123
  if echo "$LINE" | grep -qE '→[[:space:]]+tests/acceptance/[^:]+\.test\.tsx?:[[:space:]]*("|[0-9])'; then
    # Found an anchor - verify the test file exists
    # Extract the test file path from the anchor
    TEST_REF=$(echo "$LINE" | grep -oE 'tests/acceptance/[^:]+\.test\.tsx?')

    # If the referenced test file doesn't exist, treat as unanchored
    if [ ! -f "$TEST_REF" ]; then
      UNANCHORED+=("$LINE (referenced test file does not exist: $TEST_REF)")
    fi
  else
    # No anchor found
    UNANCHORED+=("$LINE")
  fi
done <<< "$CRITERIA"

if [ ${#UNANCHORED[@]} -gt 0 ]; then
  echo "Error: Found unanchored acceptance criteria:" >&2
  echo >&2
  for CRITERION in "${UNANCHORED[@]}"; do
    echo "  - $CRITERION" >&2
  done
  echo >&2
  echo "Each acceptance criterion must include an anchor reference like:" >&2
  echo "  → tests/acceptance/N.test.ts: \"describe block > it block\"" >&2
  echo "  → tests/acceptance/N.test.ts:123" >&2
  exit 1
fi

echo "All acceptance criteria are anchored."
exit 0
