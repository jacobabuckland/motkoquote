# shellcheck shell=bash
# Shared helpers. Written for macOS bash 3.2 + BSD tools (also works on Linux).
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$FACTORY_DIR/.." && pwd)"

# shellcheck source=/dev/null
[ -f "$FACTORY_DIR/config.local.sh" ] && . "$FACTORY_DIR/config.local.sh"
# shellcheck source=config.sh
. "$FACTORY_DIR/config.sh"

STATE_DIR="$REPO_ROOT/.factory"
TASKS_DIR="$STATE_DIR/tasks"
LOGS_DIR="$STATE_DIR/logs"
BACKLOG="$STATE_DIR/backlog.md"
WT_ROOT="${FACTORY_WORKTREE_ROOT:-$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-worktrees}"

say()  { printf '[factory] %s\n' "$*" >&2; }
die()  { printf '[factory] ERROR: %s\n' "$*" >&2; exit 1; }

validate_id() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "ticket id must be lowercase letters, digits and dashes (got '${1:-}')"
}

wt_path()     { echo "$WT_ROOT/$1"; }
task_path()   { echo "$TASKS_DIR/$1.md"; }
branch_name() { echo "factory/$1"; }
round_file()  { echo "$TASKS_DIR/$1.round"; }
gate_file()   { echo "$TASKS_DIR/$1.gate"; }

current_round() { local f; f="$(round_file "$1")"; [ -f "$f" ] && cat "$f" || echo 0; }

require_ticket() {
  validate_id "$1"
  [ -f "$(task_path "$1")" ] || die "no task file for '$1' (run factory/new-ticket.sh first)"
  [ -d "$(wt_path "$1")" ]   || die "no worktree for '$1' at $(wt_path "$1")"
}

# Print the bullet items under a "## Heading" in a markdown file.
section_items() {
  awk -v h="## $2" '
    { line=$0; sub(/[[:space:]]+$/, "", line) }
    line==h { on=1; next }
    on && /^## / { exit }
    on && /^[[:space:]]*[-*] / { sub(/^[[:space:]]*[-*] /, "", line); gsub(/`/, "", line); print line }
  ' "$1"
}

# Run a command with a timeout (macOS has no `timeout`; perl is always there).
with_timeout() {
  local secs="$1"; shift
  perl -e 'my $t = shift; $SIG{ALRM} = sub { kill "TERM", $pid; exit 124 }; $pid = fork; if (!$pid) { exec @ARGV or exit 127 } alarm $t; waitpid $pid, 0; exit ($? >> 8)' "$secs" "$@"
}

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'; else sha256sum | awk '{print $1}'; fi; }

# Build/test artifacts the factory never counts as changes or commits, even if the repo's
# .gitignore misses them (e.g. __pycache__ created by the gate's own test run).
ARTIFACTS=(
  ':(exclude,glob)**/__pycache__/**' ':(exclude,glob)**/*.pyc' ':(exclude,glob)**/.pytest_cache/**'
  ':(exclude,glob)**/node_modules/**' ':(exclude,glob)**/.next/**' ':(exclude,glob)**/coverage/**'
  ':(exclude,glob)**/.turbo/**' ':(exclude,glob)**/*.tsbuildinfo' ':(exclude,glob)**/.DS_Store'
)

# Stage everything the builder changed (minus artifacts) in a worktree.
stage_all() { ( cd "$1" && git reset -q && git add -A -- . "${ARTIFACTS[@]}" ); }

# Files changed in a worktree relative to its base commit (tracked + untracked, minus artifacts).
changed_files() {
  ( cd "$1" && { git diff --name-only HEAD -- . "${ARTIFACTS[@]}"
                 git ls-files --others --exclude-standard -- . "${ARTIFACTS[@]}"; } | sort -u )
}

detect_test_cmd() {
  local d="$1"
  if [ -n "$FACTORY_TEST_CMD" ]; then echo "$FACTORY_TEST_CMD"; return; fi
  if [ -f "$d/package.json" ] && grep -q '"test"[[:space:]]*:' "$d/package.json" \
     && ! grep -q 'no test specified' "$d/package.json"; then echo "npm test --silent"; return; fi
  if [ -f "$d/pytest.ini" ] || [ -f "$d/pyproject.toml" ] || [ -d "$d/tests" ]; then
    command -v pytest >/dev/null 2>&1 && { echo "pytest -q"; return; }
  fi
  [ -f "$d/Cargo.toml" ] && { echo "cargo test"; return; }
  [ -f "$d/go.mod" ] && { echo "go test ./..."; return; }
  echo ""
}

# Run the builder as a headless Claude Code session pointed at Ollama.
# Usage: run_agent_builder <cwd> <ticket_file> <log> <timeout_secs>
run_agent_builder() {
  local cwd="$1" ticket="$2" log="$3" secs="$4"
  command -v claude >/dev/null 2>&1 || die "claude CLI not found on PATH"

  # Feature-detect flags once per Claude Code version (older versions lack some).
  local ver feat
  ver="$(claude --version 2>/dev/null | awk '{print $1}')"
  feat="$STATE_DIR/claude-features-$ver"
  [ -s "$feat" ] || claude --help > "$feat" 2>&1 || true

  local msg="$ticket.msg"
  local args=(-p --model "$FACTORY_BUILDER_MODEL" --permission-mode acceptEdits --output-format text)
  grep -q -- '--bare' "$feat" && args+=(--bare)
  grep -q -- '--strict-mcp-config' "$feat" && args+=(--strict-mcp-config)
  grep -q -- '--tools <' "$feat" && args+=(--tools "Read,Edit,Write,Glob,Grep,Bash")
  if [ "${FACTORY_BUILDER_SLIM_PROMPT:-true}" = "true" ] && grep -q -- '--system-prompt <' "$feat"; then
    # Replace Claude Code's large default system prompt: saves ~10k+ tokens of a small model's context.
    args+=(--system-prompt "$(cat "$FACTORY_DIR/builder-prompt.md") (Use your tools to read and edit files; do not just describe the changes.)")
    cp "$ticket" "$msg"
  else
    { cat "$FACTORY_DIR/builder-prompt.md"; echo; cat "$ticket"; } > "$msg"
  fi
  local deny allow
  IFS=',' read -r -a deny <<< "$FACTORY_BUILDER_DENY"
  IFS=',' read -r -a allow <<< "$FACTORY_BUILDER_TOOLS"
  args+=(--disallowedTools "${deny[@]}" --allowedTools "${allow[@]}")

  local M="$FACTORY_BUILDER_MODEL" rc=0
  ( cd "$cwd" && with_timeout "$secs" env \
      -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_CUSTOM_HEADERS \
      ANTHROPIC_BASE_URL="$FACTORY_OLLAMA_URL" ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY=ollama \
      ANTHROPIC_MODEL="$M" ANTHROPIC_DEFAULT_OPUS_MODEL="$M" ANTHROPIC_DEFAULT_SONNET_MODEL="$M" \
      ANTHROPIC_DEFAULT_HAIKU_MODEL="$M" ANTHROPIC_SMALL_FAST_MODEL="$M" CLAUDE_CODE_SUBAGENT_MODEL="$M" \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 \
      FACTORY_ROLE=builder \
      claude "${args[@]}" < "$msg" ) > "$log" 2>&1 || rc=$?
  return "$rc"
}

mkdir -p "$TASKS_DIR" "$LOGS_DIR"
