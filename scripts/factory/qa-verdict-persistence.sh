#!/usr/bin/env bash
#
# QA verdict persistence for stateful reviews across cycles.
# Extracts, validates, and formats verdict blocks in issue comments.

set -euo pipefail

# Extract verdict blocks from issue comments and return as JSON array
# Usage: extract_verdicts ISSUE_NUMBER
extract_verdicts() {
  local issue_number="$1"

  # Fetch all comments for the issue
  local comments
  comments=$(gh api "repos/${GH_REPO}/issues/${issue_number}/comments" \
    --paginate --slurp --jq 'add // []')

  # Extract verdict blocks using jq and regex
  # Pattern: <!-- qa-verdict-N {...json...} -->
  printf '%s' "$comments" | jq -r '
    [
      .[] |
      .body |
      scan("<!--\\s*qa-verdict-\\d+\\s+({[^>]+})\\s*-->") |
      .[0] |
      try fromjson catch empty
    ]
  ' 2>/dev/null || echo "[]"
}

# Validate a finding against prior verdicts
# Usage: validate_finding FINDING_JSON PRIOR_VERDICTS_JSON CURRENT_COMMIT
# Returns: JSON with {valid: bool, reason: string}
validate_finding() {
  local finding_json="$1"
  local prior_verdicts_json="$2"
  local current_commit="$3"

  local criterion file
  criterion=$(printf '%s' "$finding_json" | jq -r '.criterion')
  file=$(printf '%s' "$finding_json" | jq -r '.file')

  # Check if this finding re-raises a criterion marked satisfied in any prior verdict
  local settled_verdict
  settled_verdict=$(printf '%s' "$prior_verdicts_json" | jq -r --arg criterion "$criterion" --arg file "$file" '
    .[] |
    select(.criteria[]? | select(.name == $criterion and .file == $file and .status == "satisfied")) |
    .commit
  ' | head -n1)

  # If not found in prior satisfied criteria, it's a new finding - accept it
  if [ -z "$settled_verdict" ]; then
    echo '{"valid":true,"reason":"new finding (not in prior satisfied criteria)"}'
    return 0
  fi

  # This is a re-raise. Check if the file changed since that commit.
  local diff_output
  if ! diff_output=$(git diff "${settled_verdict}..${current_commit}" -- "$file" 2>/dev/null); then
    # Git diff failed (commit doesn't exist?), fail open
    echo '{"valid":true,"reason":"git diff failed - failing open"}'
    return 0
  fi

  # If no changes, reject the finding
  if [ -z "$diff_output" ]; then
    local cycle
    cycle=$(printf '%s' "$prior_verdicts_json" | jq -r --arg commit "$settled_verdict" '
      .[] | select(.commit == $commit) | .cycle
    ' | head -n1)
    echo "{\"valid\":false,\"reason\":\"unchanged since cycle ${cycle}\"}"
    return 0
  fi

  # Code changed - does the finding message reference the change?
  local message
  message=$(printf '%s' "$finding_json" | jq -r '.message' | tr '[:upper:]' '[:lower:]')

  # Check for change keywords
  local keywords=("changed" "modified" "updated" "now" "became" "switched" "added" "removed" "replaced" "at line")
  local has_change_ref=false

  for keyword in "${keywords[@]}"; do
    if [[ "$message" == *"$keyword"* ]]; then
      has_change_ref=true
      break
    fi
  done

  if [ "$has_change_ref" = false ]; then
    echo '{"valid":false,"reason":"does not name what changed (re-raised finding must reference specific code change)"}'
    return 0
  fi

  echo '{"valid":true,"reason":"code changed and finding names the change"}'
}

# Format a verdict as an HTML comment block
# Usage: append_verdict_block CYCLE COMMIT CRITERIA_JSON FINDINGS_JSON
# Outputs: <!-- qa-verdict-N {...} -->
append_verdict_block() {
  local cycle="$1"
  local commit="$2"
  local criteria_json="$3"
  local findings_json="$4"

  local verdict
  verdict=$(jq -n \
    --argjson cycle "$cycle" \
    --arg commit "$commit" \
    --argjson criteria "$criteria_json" \
    --argjson findings "$findings_json" \
    '{cycle: $cycle, commit: $commit, criteria: $criteria, findings: $findings}')

  printf '<!-- qa-verdict-%s %s -->' "$cycle" "$verdict"
}

# Filter out verdicts with commits that don't exist in current branch history
# Usage: filter_stale_verdicts VERDICTS_JSON
filter_stale_verdicts() {
  local verdicts_json="$1"

  printf '%s' "$verdicts_json" | jq -c '.[] | .commit' | while IFS= read -r commit_line; do
    local commit
    commit=$(printf '%s' "$commit_line" | jq -r '.')

    # Check if commit exists in current branch
    if git rev-parse --verify "${commit}^{commit}" >/dev/null 2>&1; then
      printf '%s' "$verdicts_json" | jq -c --arg commit "$commit" '.[] | select(.commit == $commit)'
    fi
  done | jq -s '.'
}

# When sourced, do nothing. When executed directly, run the function named in $1
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  "${@}"
fi
