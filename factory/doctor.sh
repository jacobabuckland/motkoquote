#!/usr/bin/env bash
# Usage: factory/doctor.sh [--no-smoke]
# Checks every dependency, creates the builder model, and runs a smoke test that
# proves the local model can actually edit files. Writes the builder mode that worked
# to factory/config.local.sh. Safe to re-run any time.
. "$(dirname "$0")/lib.sh"
set +e   # report every problem instead of stopping at the first

smoke=true; [ "${1:-}" = "--no-smoke" ] && smoke=false
problems=0
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; problems=$((problems + 1)); }

ver_ge() { # ver_ge 0.15.2 0.14.0
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 0 }'
}

echo "LLM Factory doctor: repo $REPO_ROOT"
echo
echo "Repo"
if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then ok "git repo"; else bad "not a git repo"; fi
if git -C "$REPO_ROOT" rev-parse --verify --quiet "$FACTORY_BASE_BRANCH" >/dev/null; then ok "base branch $FACTORY_BASE_BRANCH"
else bad "base branch '$FACTORY_BASE_BRANCH' missing (set FACTORY_BASE_BRANCH in factory/config.local.sh)"; fi
if git -C "$REPO_ROOT" remote get-url "$FACTORY_REMOTE" >/dev/null 2>&1; then ok "remote $FACTORY_REMOTE: $(git -C "$REPO_ROOT" remote get-url "$FACTORY_REMOTE")"
else warn "no '$FACTORY_REMOTE' remote: ship.sh needs one to push"; fi
if grep -qs '^\.factory/' "$REPO_ROOT/.gitignore"; then ok ".factory/ is gitignored"; else warn ".factory/ is not in .gitignore"; fi
tc="$(detect_test_cmd "$REPO_ROOT")"
if [ -n "$tc" ]; then ok "test command: $tc"; else warn "no test command detected: set FACTORY_TEST_CMD (the gate is much weaker without tests)"; fi

echo
echo "Owner (Claude Code on Claude)"
if command -v claude >/dev/null 2>&1; then ok "claude $(claude --version 2>/dev/null | head -n 1)"; else bad "claude CLI not installed (curl -fsSL https://claude.ai/install.sh | bash)"; fi
if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  warn "ANTHROPIC_BASE_URL is set in this shell ($ANTHROPIC_BASE_URL). The OWNER must run on real Claude: remove it from your shell profile. The builder sets its own."
else ok "owner shell is not redirected to Ollama"; fi
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then ok "gh authenticated"; else bad "gh not logged in (gh auth login)"; fi
else bad "gh CLI missing (brew install gh)"; fi
for b in python3 perl curl; do command -v "$b" >/dev/null 2>&1 && ok "$b" || bad "$b missing"; done

echo
echo "Builder (Ollama)"
if command -v ollama >/dev/null 2>&1; then
  ov="$(ollama --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
  if [ -n "$ov" ] && ver_ge "$ov" 0.14.0; then ok "ollama $ov"; else bad "ollama ${ov:-unknown} is too old: need 0.14+ for Claude Code (brew upgrade ollama or update the app)"; fi
else bad "ollama not installed (https://ollama.com/download)"; fi

if curl -sf "$FACTORY_OLLAMA_URL/api/version" >/dev/null 2>&1; then
  ok "ollama server answering at $FACTORY_OLLAMA_URL"
  models="$(curl -sf "$FACTORY_OLLAMA_URL/api/tags" | python3 -c 'import json,sys; print("\n".join(m["name"] for m in json.load(sys.stdin).get("models", [])))')"
  has_model() { echo "$models" | grep -qx -e "$1" -e "$1:latest"; }
  if has_model "$FACTORY_BASE_MODEL"; then ok "base model $FACTORY_BASE_MODEL pulled"
  else say "pulling $FACTORY_BASE_MODEL ..."; ollama pull "$FACTORY_BASE_MODEL" && ok "pulled $FACTORY_BASE_MODEL" || bad "could not pull $FACTORY_BASE_MODEL"; fi

  mf="$STATE_DIR/Modelfile"
  printf 'FROM %s\nPARAMETER num_ctx %s\nPARAMETER temperature 0.3\n' "$FACTORY_BASE_MODEL" "$FACTORY_CONTEXT" > "$mf"
  want="$(sha < "$mf")"; have="$(cat "$STATE_DIR/Modelfile.sha" 2>/dev/null)"
  if has_model "$FACTORY_BUILDER_MODEL" && [ "$want" = "$have" ]; then ok "builder model $FACTORY_BUILDER_MODEL (ctx $FACTORY_CONTEXT)"
  else
    if ollama create "$FACTORY_BUILDER_MODEL" -f "$mf" >/dev/null 2>&1; then
      echo "$want" > "$STATE_DIR/Modelfile.sha"; ok "created $FACTORY_BUILDER_MODEL from $FACTORY_BASE_MODEL with ctx $FACTORY_CONTEXT"
    else bad "ollama create $FACTORY_BUILDER_MODEL failed"; fi
  fi
else
  bad "ollama server not answering at $FACTORY_OLLAMA_URL (open the Ollama app)"
  smoke=false
fi

if [ "$smoke" = true ] && [ "$problems" = 0 ]; then
  echo
  echo "Smoke test: can the local model actually edit files?"
  sdir="$(mktemp -d)"
  cat > "$sdir/ticket.md" <<'EOF'
# Ticket smoke: create hello.py

## Goal
Create a file named hello.py containing a Python function add(a, b) that returns a + b.

## Allowed files
- hello.py
EOF
  check() { grep -qs 'def add' "$sdir/work/hello.py"; }
  fresh() { rm -rf "$sdir/work"; mkdir -p "$sdir/work"; }
  mode=""
  fresh; FACTORY_BUILDER_SLIM_PROMPT=true run_agent_builder "$sdir/work" "$sdir/ticket.md" "$LOGS_DIR/smoke-agent-slim.log" 600
  if check; then mode="agent-slim"; else
    warn "agent mode with slim prompt did not write the file (log: $LOGS_DIR/smoke-agent-slim.log)"
    fresh; FACTORY_BUILDER_SLIM_PROMPT=false run_agent_builder "$sdir/work" "$sdir/ticket.md" "$LOGS_DIR/smoke-agent-full.log" 600
    if check; then mode="agent-full"; else
      warn "agent mode with full prompt did not write the file (log: $LOGS_DIR/smoke-agent-full.log)"
      fresh; with_timeout 600 python3 "$FACTORY_DIR/direct_build.py" --task "$sdir/ticket.md" --worktree "$sdir/work" \
        --model "$FACTORY_BUILDER_MODEL" --url "$FACTORY_OLLAMA_URL" --ctx "$FACTORY_CONTEXT" > "$LOGS_DIR/smoke-direct.log" 2>&1
      check && mode="direct"
    fi
  fi
  rm -rf "$sdir"

  local_cfg="$FACTORY_DIR/config.local.sh"
  touch "$local_cfg"
  awk '/^# >>> doctor/{skip=1} !skip{print} /^# <<< doctor/{skip=0}' "$local_cfg" > "$local_cfg.tmp" && mv "$local_cfg.tmp" "$local_cfg"
  case "$mode" in
    agent-slim) ok "builder works in agent mode (slim prompt)"; m=agent; slim=true ;;
    agent-full) ok "builder works in agent mode (full Claude Code prompt)"; m=agent; slim=false ;;
    direct)     ok "agent mode failed but direct mode works: builder will use direct mode"; m=direct; slim=true ;;
    *)          bad "the local model could not complete the smoke test in any mode (logs in $LOGS_DIR/smoke-*.log). Try a bigger model: FACTORY_BASE_MODEL=qwen3-coder:30b"; m="" ;;
  esac
  if [ -n "$m" ]; then
    { echo "# >>> doctor (written by factory/doctor.sh $(date '+%Y-%m-%d'))"
      echo ": \"\${FACTORY_BUILDER_MODE:=$m}\""
      echo ": \"\${FACTORY_BUILDER_SLIM_PROMPT:=$slim}\""
      echo "# <<< doctor"; } >> "$local_cfg"
    ok "saved builder mode to factory/config.local.sh"
  fi
fi

echo
if [ "$problems" = 0 ]; then echo "doctor: all good"; exit 0; fi
echo "doctor: $problems problem(s) to fix"; exit 1
