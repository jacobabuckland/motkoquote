#!/usr/bin/env bash
# Usage: factory/new-ticket.sh <id> "<title>"
# Creates branch factory/<id>, a git worktree for it, and .factory/tasks/<id>.md from the template.
. "$(dirname "$0")/lib.sh"

id="${1:-}"; title="${2:-}"
validate_id "$id"
[ -n "$title" ] || die 'usage: factory/new-ticket.sh <id> "<title>"'
[ -e "$(task_path "$id")" ] && die "ticket '$id' already exists"
[ -e "$(wt_path "$id")" ] && die "worktree already exists: $(wt_path "$id")"

cd "$REPO_ROOT"
base="$FACTORY_BASE_BRANCH"
if git remote get-url "$FACTORY_REMOTE" >/dev/null 2>&1 \
   && git fetch --quiet "$FACTORY_REMOTE" "$FACTORY_BASE_BRANCH" 2>/dev/null; then
  base="$FACTORY_REMOTE/$FACTORY_BASE_BRANCH"
fi
git rev-parse --verify --quiet "$base" >/dev/null || die "base branch '$base' not found"

mkdir -p "$WT_ROOT"
git worktree add --quiet -b "$(branch_name "$id")" "$(wt_path "$id")" "$base"

awk -v id="$id" -v t="$title" '{ gsub(/\{\{ID\}\}/, id); gsub(/\{\{TITLE\}\}/, t); print }' \
  "$FACTORY_DIR/templates/task.md" > "$(task_path "$id")"
echo 0 > "$(round_file "$id")"
rm -f "$(gate_file "$id")"

say "ticket '$id' ready"
echo "task file: $(task_path "$id")"
echo "worktree:  $(wt_path "$id")"
echo "branch:    $(branch_name "$id")  (from $base)"
echo "next: fill in the task file, then run factory/build.sh $id"
