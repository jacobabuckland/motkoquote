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
    else
      # Test file exists - now verify the assertion/line number exists

      # Check if it's a line number reference (→ file.test.ts:123)
      if echo "$LINE" | grep -qE '→[[:space:]]+tests/acceptance/[^:]+\.test\.tsx?:[[:space:]]*[0-9]+'; then
        # Extract the line number
        LINE_NUM=$(echo "$LINE" | grep -oE ':[[:space:]]*[0-9]+' | grep -oE '[0-9]+')

        # Check if the test file has that many lines
        TOTAL_LINES=$(wc -l < "$TEST_REF")
        if [ "$LINE_NUM" -gt "$TOTAL_LINES" ]; then
          UNANCHORED+=("$LINE (line $LINE_NUM does not exist in $TEST_REF, which has $TOTAL_LINES lines)")
        else
          # Line exists - verify it's within a test block (contains 'it(' or 'describe(')
          # We'll check if the line or any nearby context contains test keywords
          CONTEXT=$(sed -n "$((LINE_NUM > 5 ? LINE_NUM - 5 : 1)),$((LINE_NUM + 5))p" "$TEST_REF")
          if ! echo "$CONTEXT" | grep -qE '(describe|it|test)\s*\('; then
            UNANCHORED+=("$LINE (line $LINE_NUM in $TEST_REF is not within a test block)")
          fi
        fi
      else
        # It's a quoted assertion reference (→ file.test.ts: "describe > it")
        # Extract the assertion text between quotes
        ASSERTION=$(echo "$LINE" | grep -oE ':[[:space:]]*"[^"]+' | sed 's/^:[[:space:]]*"//')

        if [ -z "$ASSERTION" ]; then
          UNANCHORED+=("$LINE (malformed assertion anchor)")
        else
          # Split on " > " to get describe and it parts
          DESCRIBE_PART=$(echo "$ASSERTION" | sed 's/\s*>\s*.*//')
          IT_PART=$(echo "$ASSERTION" | sed 's/.*\s*>\s*//')

          # Verify both parts exist as actual test blocks (not just strings in the file)
          # Look for patterns like describe("name" or describe('name' or it("name" or it('name'
          # Escape special regex characters in the parts
          DESCRIBE_ESCAPED=$(echo "$DESCRIBE_PART" | sed 's/[]\/$*.^[]/\\&/g')
          IT_ESCAPED=$(echo "$IT_PART" | sed 's/[]\/$*.^[]/\\&/g')

          # Check for describe block patterns
          if ! grep -qE "(describe|context)\s*\(\s*[\"']$DESCRIBE_ESCAPED[\"']" "$TEST_REF"; then
            UNANCHORED+=("$LINE (describe block \"$DESCRIBE_PART\" not found in $TEST_REF)")
          # Check for it block patterns
          elif ! grep -qE "(it|test|specify)\s*\(\s*[\"']$IT_ESCAPED[\"']" "$TEST_REF"; then
            UNANCHORED+=("$LINE (it block \"$IT_PART\" not found in $TEST_REF)")
          else
            # Both exist - do a basic nesting check
            # Extract line numbers where each appears in actual test declarations
            DESCRIBE_LINE=$(grep -nE "(describe|context)\s*\(\s*[\"']$DESCRIBE_ESCAPED[\"']" "$TEST_REF" | head -1 | cut -d: -f1)
            IT_LINE=$(grep -nE "(it|test|specify)\s*\(\s*[\"']$IT_ESCAPED[\"']" "$TEST_REF" | head -1 | cut -d: -f1)

            # The it block should appear after the describe block
            if [ -n "$DESCRIBE_LINE" ] && [ -n "$IT_LINE" ] && [ "$IT_LINE" -le "$DESCRIBE_LINE" ]; then
              UNANCHORED+=("$LINE (it block appears before describe block in $TEST_REF)")
            fi
          fi
        fi
      fi
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
