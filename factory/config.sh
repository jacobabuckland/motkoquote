# shellcheck shell=bash
# LLM Factory configuration. Every value can be overridden by exporting it
# before running a script, or by creating factory/config.local.sh (gitignored).

# --- Builder (local model via Ollama) ---------------------------------------
FACTORY_BASE_MODEL="${FACTORY_BASE_MODEL:-qwen3:8b}"        # what you pulled in Ollama
FACTORY_BUILDER_MODEL="${FACTORY_BUILDER_MODEL:-qwen3-builder}"  # derived model with bigger context (doctor.sh creates it)
FACTORY_CONTEXT="${FACTORY_CONTEXT:-40960}"                 # qwen3:8b's native max is ~40k tokens
FACTORY_OLLAMA_URL="${FACTORY_OLLAMA_URL:-http://localhost:11434}"

# agent  = builder is a headless Claude Code session running on the local model (edits files, runs tests)
# direct = builder is a single Ollama call that returns whole files (more reliable on small models)
FACTORY_BUILDER_MODE="${FACTORY_BUILDER_MODE:-agent}"
FACTORY_BUILDER_TIMEOUT="${FACTORY_BUILDER_TIMEOUT:-1500}"  # seconds per build round
FACTORY_BUILDER_MAX_TURNS="${FACTORY_BUILDER_MAX_TURNS:-40}"

# Tools the builder may use. Bash is limited to test/lint/build commands.
FACTORY_BUILDER_TOOLS="${FACTORY_BUILDER_TOOLS:-Read,Edit,Write,Glob,Grep,Bash(npm test:*),Bash(npm run test:*),Bash(npm run lint:*),Bash(npm run build:*),Bash(npm run typecheck:*),Bash(npx tsc:*),Bash(npx vitest:*),Bash(npx jest:*),Bash(pytest:*),Bash(python3 -m pytest:*),Bash(ls:*)}"
FACTORY_BUILDER_DENY="${FACTORY_BUILDER_DENY:-WebFetch,WebSearch,Task,Bash(git:*),Bash(gh:*),Bash(factory/:*),Bash(./factory/:*),Bash(curl:*),Bash(wget:*),Bash(rm:*),Bash(sudo:*)}"

# --- Review gate --------------------------------------------------------------
FACTORY_MAX_ROUNDS="${FACTORY_MAX_ROUNDS:-3}"   # builder attempts per ticket before the owner takes over
FACTORY_TEST_CMD="${FACTORY_TEST_CMD:-}"        # e.g. "npm test". Blank = auto-detect
FACTORY_LINT_CMD="${FACTORY_LINT_CMD:-}"        # e.g. "npm run lint". Blank = skip

# --- Shipping -----------------------------------------------------------------
FACTORY_BASE_BRANCH="${FACTORY_BASE_BRANCH:-main}"
FACTORY_REMOTE="${FACTORY_REMOTE:-origin}"
FACTORY_AUTO_MERGE="${FACTORY_AUTO_MERGE:-false}"  # true = enable GitHub auto-merge once CI passes
FACTORY_DRAFT_PR="${FACTORY_DRAFT_PR:-false}"

# --- Autopilot ----------------------------------------------------------------
FACTORY_AUTOPILOT_MAX_TICKETS="${FACTORY_AUTOPILOT_MAX_TICKETS:-5}"  # per autopilot run
FACTORY_OWNER_MODEL="${FACTORY_OWNER_MODEL:-}"  # blank = your Claude Code default
