#!/usr/bin/env bash
# Usage: factory/autopilot.sh [max_tickets]
# Runs the OWNER headless (real Claude) on the backlog, one ticket per session, until the
# backlog is empty or max_tickets is reached. Safe to run from cron/launchd.
. "$(dirname "$0")/lib.sh"

# cron/launchd start with a bare PATH
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

max="${1:-$FACTORY_AUTOPILOT_MAX_TICKETS}"
[ -f "$BACKLOG" ] || die "no backlog at $BACKLOG: run /factory <goal> in Claude Code first"

lock="$STATE_DIR/autopilot.lock"
if ! mkdir "$lock" 2>/dev/null; then die "autopilot already running (remove $lock if it is stale)"; fi
trap 'rmdir "$lock" 2>/dev/null' EXIT

model=(); [ -n "$FACTORY_OWNER_MODEL" ] && model=(--model "$FACTORY_OWNER_MODEL")
cd "$REPO_ROOT"
n=0
while [ "$n" -lt "$max" ]; do
  grep -q '^- \[ \]' "$BACKLOG" || { say "backlog empty"; break; }
  n=$((n + 1))
  before="$(sha < "$BACKLOG")"
  log="$LOGS_DIR/autopilot-$(date +%Y%m%d-%H%M%S)-$n.log"
  say "autopilot ticket $n/$max (log: $log)"
  # The owner must run on real Claude, never on the Ollama redirect.
  env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL -u FACTORY_ROLE \
    claude -p --permission-mode acceptEdits --output-format text ${model[@]+"${model[@]}"} \
    "Follow the instructions in .claude/commands/factory-next.md exactly." > "$log" 2>&1 \
    || say "owner session exited non-zero (see $log)"
  tail -n 15 "$log"
  if [ "$(sha < "$BACKLOG")" = "$before" ]; then say "backlog did not change: stopping so a stuck ticket doesn't loop"; break; fi
done
factory/status.sh
