#!/usr/bin/env bash
#
# The item's contract — its spec and its acceptance tests — is frozen after the
# PM's first commit. An implementation that can rewrite the contract it is
# judged against can make any fidelity finding disappear, so the Engineer may
# not touch either.
#
# One file under tests/acceptance is not that, and must not be treated as that.
# tests/acceptance/99.test.ts is a standing registry: every API route in the
# repository is classified there as public or protected, and AGENTS.md requires
# new work to register its route through it —
#
#   "A standing registry or inventory that ships with an intended registration
#    path — the public-API-route list in tests/acceptance/99.test.ts is the one
#    to know — is not frozen, and adding an entry through that path is
#    registration, not repair."
#
# Hashing it with the rest made those two rules contradict each other: LED-6
# adds an API route, registering it is mandatory, and the guard rejected the
# registration. A complete, CI-green implementation was discarded for doing what
# the instructions require. A guard that blocks the work it is meant to protect
# is a defect.
#
# So the registry is checked on its own terms rather than exempted. Additions
# are permitted; deletions and modifications are not. That keeps every reason
# the freeze exists: a route cannot be quietly removed from the registry's view,
# and no existing assertion can be weakened, because weakening one means
# changing a line that is already there. Adding a route is the only thing that
# gets through, and adding a route is the thing that is supposed to.
#
# An addition is reported loudly rather than passed over. AGENTS.md is explicit
# that registering a route is a DECISION NEEDED-equivalent notice — a human is
# meant to see a new unauthenticated surface, and that is the whole point of the
# check firing.
#
# Usage: verify-frozen-contract.sh record <snapshot-path>
#        verify-frozen-contract.sh verify <snapshot-path> <base-sha>
set -euo pipefail

REGISTRY="${FROZEN_REGISTRY:-tests/acceptance/99.test.ts}"
ROOTS_DEFAULT="tests/acceptance docs/specs"
read -r -a ROOTS <<< "${FROZEN_ROOTS:-$ROOTS_DEFAULT}"

# The registry is excluded from the fingerprint on both sides, so it is never
# the thing that trips the byte-for-byte comparison. It gets its own check.
fingerprint() {
  find "${ROOTS[@]}" -type f ! -path "$REGISTRY" -exec sha256sum {} \; | sort
}

MODE="${1:-}"
SNAPSHOT="${2:-}"

if [ -z "$MODE" ] || [ -z "$SNAPSHOT" ]; then
  echo "usage: verify-frozen-contract.sh record <snapshot> | verify <snapshot> <base-sha>" >&2
  exit 2
fi

case "$MODE" in
  record)
    fingerprint > "$SNAPSHOT"
    cat "$SNAPSHOT"
    ;;

  verify)
    BASE="${3:-}"
    if [ -z "$BASE" ]; then
      echo "verify needs a base sha to diff the registry against" >&2
      exit 2
    fi

    AFTER="$(mktemp)"
    fingerprint > "$AFTER"

    if ! diff -q "$SNAPSHOT" "$AFTER" > /dev/null; then
      echo "::error::Engineer modified the spec or the acceptance tests. Neither is writable by the Engineer: they are the contract this work is judged against."
      diff "$SNAPSHOT" "$AFTER" || true
      exit 1
    fi

    # Diffed against the recorded base rather than the working tree, because the
    # agent can commit on its own — a committed change leaves `git diff` empty
    # and would otherwise pass unseen.
    STAT="$(git diff --numstat "$BASE" -- "$REGISTRY")"

    if [ -n "$STAT" ]; then
      ADDED="$(printf '%s\n' "$STAT" | awk '{print $1}')"
      DELETED="$(printf '%s\n' "$STAT" | awk '{print $2}')"

      if [ "$DELETED" != "0" ]; then
        echo "::error::Engineer removed or rewrote $DELETED line(s) in $REGISTRY. Registering a route is adding a line; anything else is repair, and the registry is not repairable here. A route that stops being seen is worse than one that fails the check."
        git diff "$BASE" -- "$REGISTRY" || true
        exit 1
      fi

      echo "::warning::$REGISTRY gained $ADDED line(s) — an API route is being classified. Read the diff below: an entry added to CURRENT_PUBLIC_API_ROUTES is a new unauthenticated surface, and a human is meant to see it."
      git diff "$BASE" -- "$REGISTRY" || true
    fi

    echo "Spec and acceptance tests unchanged."
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
