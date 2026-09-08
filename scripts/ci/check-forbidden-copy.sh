#!/usr/bin/env bash
set -euo pipefail

# Check for forbidden payment speed claims in trade-facing source files
# Context: RAIL-3 - Rail advantages are scheduling and chasing, not settlement speed

SCAN_PATH="${TEST_SCAN_PATH:-src/app/}"

# Exit cleanly if directory doesn't exist
if [ ! -d "$SCAN_PATH" ]; then
  echo "No directory to scan"
  exit 0
fi

# Find all TypeScript/JavaScript source files
FILES=$(find "$SCAN_PATH" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) 2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "No source files found"
  exit 0
fi

# Build pattern for forbidden phrases that claim payment/settlement speed advantages
PATTERN='(faster|quicker) (payment|settlement)'
PATTERN="$PATTERN|faster than.*(bank transfer|transfer)"
PATTERN="$PATTERN|instant (payment|settlement)"
PATTERN="$PATTERN|immediate (payment|settlement)"
PATTERN="$PATTERN|quick payment"
PATTERN="$PATTERN|rapid settlement"
PATTERN="$PATTERN|speedy payment"
PATTERN="$PATTERN|payment speed"
PATTERN="$PATTERN|settlement speed"

# Search for violations and capture output
VIOLATIONS=$(echo "$FILES" | xargs grep -H -n -i -E "$PATTERN" 2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
  # Print violations to stderr (includes filename:line:content)
  echo "$VIOLATIONS" >&2
  echo "" >&2
  echo "ERROR: Forbidden payment speed claims detected" >&2
  echo "Rail advantages: scheduling and automatic chasing, not settlement speed" >&2
  echo "Remove phrases claiming faster/instant/quick payment or settlement" >&2
  exit 1
fi

echo "No forbidden payment speed claims found"
exit 0
