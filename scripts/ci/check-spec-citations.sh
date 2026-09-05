#!/usr/bin/env bash
set -euo pipefail

# Check spec citations - ensures all backticked .md references exist

# Find all spec files
if [ ! -d "docs/specs" ]; then
  # No specs directory, nothing to check
  exit 0
fi

# Temporary file for missing citations
missing=$(mktemp)
trap "rm -f $missing" EXIT

# Extract all backticked .md references from all spec files
find docs/specs -type f -name "*.md" -exec grep -h -o '`[^`]*\.md`' {} \; 2>/dev/null | sort -u | while IFS= read -r match; do
  [ -z "$match" ] && continue

  # Remove the backticks
  cited_path=$(echo "$match" | sed 's/^`//; s/`$//')

  # Skip empty citations
  [ -z "$cited_path" ] && continue

  # Check if the file exists (relative to current directory)
  if [ ! -f "$cited_path" ]; then
    echo "$cited_path" >> "$missing"
  fi
done

# Report any missing files
if [ -s "$missing" ]; then
  cat "$missing" >&2
  exit 1
fi

exit 0
