#!/usr/bin/env bash
# Usage: factory/gate.sh <id>
# Mechanical review gate: scope check, secret scan, lint, tests.
# Writes a report to .factory/logs/<id>-gate.md. Exit 0 = PASS, 1 = FAIL.
# The owner still reads the diff afterwards; this gate only catches what a script can.
. "$(dirname "$0")/lib.sh"

id="${1:-}"; require_ticket "$id"
wt="$(wt_path "$id")"; task="$(task_path "$id")"
report="$LOGS_DIR/$id-gate.md"
rm -f "$(gate_file "$id")"
fail=0

{
  echo "# Gate report: $id (round $(current_round "$id"))"
  echo

  files="$(changed_files "$wt")"
  echo "## Changed files"
  if [ -z "$files" ]; then echo "- (none)"; fail=1; else echo "$files" | sed 's/^/- /'; fi
  echo

  echo "## Scope check"
  allowed="$(section_items "$task" "Allowed files" | sed '/^[[:space:]]*$/d')"
  if [ -z "$allowed" ]; then
    echo "- FAIL: the task has no 'Allowed files' entries"; fail=1
  else
    out_of_scope=""
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      ok=0
      while IFS= read -r pat; do
        # shellcheck disable=SC2053  # unquoted on purpose: glob match; * also matches /
        [[ "$f" == $pat ]] && { ok=1; break; }
      done <<< "$allowed"
      [ "$ok" = 1 ] || out_of_scope="$out_of_scope$f"$'\n'
    done <<< "$files"
    if [ -n "$out_of_scope" ]; then
      echo "- FAIL: files changed outside 'Allowed files':"; printf '%s' "$out_of_scope" | sed '/^$/d; s/^/  - /'; fail=1
    else
      echo "- PASS"
    fi
  fi
  echo

  echo "## Secret scan"
  stage_all "$wt"
  hits="$(cd "$wt" && git diff --cached HEAD -U0 | grep -E '^\+' \
    | grep -E -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -e 'AKIA[0-9A-Z]{16}' -e 'sk-[A-Za-z0-9_-]{20,}' \
              -e 'gh[pousr]_[A-Za-z0-9]{30,}' -e 'xox[baprs]-[A-Za-z0-9-]{10,}' -e 'sk_live_[A-Za-z0-9]{10,}' || true)"
  if [ -n "$hits" ]; then echo "- FAIL: possible secrets in the diff:"; echo "$hits" | cut -c1-120 | sed 's/^/  /'; fail=1
  else echo "- PASS"; fi
  echo

  run_step() { # name, command
    echo "## $1: \`$2\`"
    local out rc=0
    out="$(cd "$wt" && with_timeout 900 bash -c "$2" 2>&1)" || rc=$?
    if [ "$rc" = 0 ]; then echo "- PASS"; else echo "- FAIL (exit $rc)"; fail=1; fi
    echo '```'; echo "$out" | tail -n 60; echo '```'; echo
  }

  [ -n "$FACTORY_LINT_CMD" ] && run_step "Lint" "$FACTORY_LINT_CMD"
  test_cmd="$(detect_test_cmd "$wt")"
  if [ -n "$test_cmd" ]; then
    # Install deps in the worktree once, if it's a node project with no node_modules.
    if [ -f "$wt/package.json" ] && [ ! -d "$wt/node_modules" ]; then
      ( cd "$wt" && { [ -f package-lock.json ] && npm ci --silent || npm install --silent; } ) >/dev/null 2>&1 || true
    fi
    run_step "Tests" "$test_cmd"
  else
    echo "## Tests"; echo "- WARN: no test command found (set FACTORY_TEST_CMD). The owner must verify behaviour by reading the code."; echo
  fi

  if [ "$fail" = 0 ]; then echo "## Result: PASS"; else echo "## Result: FAIL"; fi
  echo "$fail" > "$STATE_DIR/.gate-rc"
} > "$report"

fail="$(cat "$STATE_DIR/.gate-rc")"; rm -f "$STATE_DIR/.gate-rc"
cat "$report"

if [ "$fail" = 0 ]; then
  # Fingerprint exactly what passed, so ship.sh refuses anything changed afterwards.
  stage_all "$wt"; ( cd "$wt" && git diff --cached HEAD | sha ) > "$(gate_file "$id")"
  say "gate PASSED. Owner: read the diff (cd $wt && git diff --cached HEAD), then factory/ship.sh $id"
  exit 0
fi
say "gate FAILED. Owner: append a '### Round $(current_round "$id")' block under '## Review feedback' in $task, then factory/build.sh $id"
exit 1
