#!/usr/bin/env bash
# Usage: factory/status.sh  — list open tickets and the backlog.
. "$(dirname "$0")/lib.sh"

printf '%-28s %-7s %-6s %s\n' TICKET ROUND GATE PR
found=0
for t in "$TASKS_DIR"/*.md; do
  [ -e "$t" ] || continue
  id="$(basename "$t" .md)"; found=1
  gate="-"; [ -f "$(gate_file "$id")" ] && gate="PASS"
  pr="-";   [ -f "$TASKS_DIR/$id.pr" ] && pr="$(cat "$TASKS_DIR/$id.pr")"
  printf '%-28s %-7s %-6s %s\n' "$id" "$(current_round "$id")/$FACTORY_MAX_ROUNDS" "$gate" "$pr"
done
[ "$found" = 1 ] || echo "(no open tickets)"
echo
if [ -f "$BACKLOG" ]; then
  echo "Backlog ($BACKLOG):"
  grep -E '^- \[[ x~!]\]' "$BACKLOG" || echo "(empty)"
fi
