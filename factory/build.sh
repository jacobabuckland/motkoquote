#!/usr/bin/env bash
# Usage: factory/build.sh <id>
# Runs one builder round on the local model inside the ticket's worktree.
# Exit codes: 0 = builder changed files, 2 = builder changed nothing,
#             3 = round limit reached (owner should take over), 124 = timed out, 1 = error.
. "$(dirname "$0")/lib.sh"

id="${1:-}"; require_ticket "$id"
wt="$(wt_path "$id")"; task="$(task_path "$id")"

round="$(current_round "$id")"
if [ "$round" -ge "$FACTORY_MAX_ROUNDS" ]; then
  say "ticket '$id' has used $round/$FACTORY_MAX_ROUNDS builder rounds: escalate (owner finishes it or splits it)"
  exit 3
fi
round=$((round + 1)); echo "$round" > "$(round_file "$id")"
rm -f "$(gate_file "$id")"
log="$LOGS_DIR/$id-round$round.log"

curl -sf "$FACTORY_OLLAMA_URL/api/version" >/dev/null 2>&1 \
  || die "Ollama is not answering at $FACTORY_OLLAMA_URL (open the Ollama app or run 'ollama serve')"

say "ticket '$id' round $round/$FACTORY_MAX_ROUNDS, mode=$FACTORY_BUILDER_MODE, model=$FACTORY_BUILDER_MODEL"
started=$(date +%s)
status=0

if [ "$FACTORY_BUILDER_MODE" = "direct" ]; then
  with_timeout "$FACTORY_BUILDER_TIMEOUT" python3 "$FACTORY_DIR/direct_build.py" \
    --task "$task" --worktree "$wt" --model "$FACTORY_BUILDER_MODEL" \
    --url "$FACTORY_OLLAMA_URL" --ctx "$FACTORY_CONTEXT" > "$log" 2>&1 || status=$?
else
  prompt_file="$LOGS_DIR/$id-round$round.prompt.md"
  cp "$task" "$prompt_file"
  run_agent_builder "$wt" "$prompt_file" "$log" "$FACTORY_BUILDER_TIMEOUT" || status=$?
fi

elapsed=$(( $(date +%s) - started ))
echo "----- builder output (tail) -----"; tail -n 40 "$log"; echo "---------------------------------"
say "builder finished in ${elapsed}s with exit $status (full log: $log)"
[ "$status" = 124 ] && { say "builder timed out"; exit 124; }

files="$(changed_files "$wt")"
if [ -z "$files" ]; then
  say "builder changed no files. If this keeps happening, the model isn't making tool calls: try FACTORY_BUILDER_MODE=direct or a bigger model"
  exit 2
fi
echo "changed files:"; echo "$files" | sed 's/^/  /'
( cd "$wt" && git diff --stat HEAD | tail -n 1 )
echo "next: factory/gate.sh $id"
