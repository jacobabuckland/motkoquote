#!/usr/bin/env bash
#
# Pushing a factory branch, for the two things that actually happen.
#
# Both failures in #277 were the same shape: an agent did its work and the push
# threw it away.
#
#   - The PM cuts factory/N fresh from main on every needs-spec run, because
#     re-deriving means starting over. Pushing that over a branch that already
#     carries a spec is a non-fast-forward, so the first derivation works and
#     every re-derivation is rejected. #239, #269 and #300 each needed a human
#     to archive and reset the branch by hand before the PM could run.
#
#   - The Engineer races the PM. It checks out the branch, builds, and by the
#     time it pushes the remote has moved, so `fetch first` rejects a complete
#     implementation that then dies with the runner.
#
# The two want opposite handling, which is why the mode is explicit rather than
# inferred:
#
#   restart  the branch is deliberately being replaced. Force, but with a lease
#            against the sha we actually saw, so a concurrent push still refuses
#            rather than being flattened.
#
#   advance  the branch is being added to. A rejection here usually means
#            something landed underneath us, so rebase onto it and try once
#            more. Anything that is not a fast-forward complaint is a real
#            failure and is not retried.
#
# The failing output is left at $PUSH_LOG (default /tmp/push.log) either way,
# because the caller quotes it back to a human, and "the push failed" without
# the reason is what sent #170 round two retries on a diagnosis that was never
# true.
#
# Usage: push-branch.sh <branch> <restart|advance>

set -uo pipefail

BRANCH="${1:?usage: push-branch.sh <branch> <restart|advance>}"
MODE="${2:-advance}"
LOG="${PUSH_LOG:-/tmp/push.log}"

# The contract paths. Whether our unpushed commits touch these is what tells an
# ordinary race apart from a branch that was restarted underneath us — see the
# advance path below.
FROZEN=(docs/specs tests/acceptance)

remote_sha() {
  git rev-parse --quiet --verify "refs/remotes/origin/$BRANCH" || true
}

git fetch -q origin "$BRANCH" 2>/dev/null || true
SEEN="$(remote_sha)"

# The pre-push guard refuses a push that would discard commits on a factory
# branch. This script is the one caller entitled to do that: `restart` rewrites
# the branch deliberately, and it does so under a lease against the sha this run
# actually saw, so a concurrent push still refuses. Having made that check, say
# so rather than letting the hook re-litigate it.
attempt() {
  export FACTORY_PUSH_GUARD=allow
  if [ -z "$SEEN" ]; then
    # Nothing there yet: an ordinary create, and a lease would have nothing to
    # check against.
    git push origin "HEAD:refs/heads/$BRANCH" > "$LOG" 2>&1
  elif [ "$MODE" = "restart" ]; then
    git push --force-with-lease="refs/heads/$BRANCH:$SEEN" \
      origin "HEAD:refs/heads/$BRANCH" > "$LOG" 2>&1
  else
    git push origin "HEAD:refs/heads/$BRANCH" > "$LOG" 2>&1
  fi
}

if attempt; then
  exit 0
fi

# One retry, and only for the cause it fixes. A rejection for a missing token
# scope or a protected branch is not a race, and rebasing at it would bury the
# real reason under a second, more confusing failure.
if [ "$MODE" = "advance" ] &&
   grep -qE "fetch first|non-fast-forward|behind its remote counterpart" "$LOG"; then
  git fetch -q origin "$BRANCH" 2>/dev/null || true

  # Rebasing replays our commits onto the remote's tip, so it is only correct
  # when what we are replaying is work the remote does not already have a
  # version of. If our side of the divergence touches a frozen contract, the
  # remote's spec commit is not our spec commit — the branch was restarted
  # while we ran — and replaying ours on top would put a second, superseded
  # copy of the contract on the branch. That trips the immutability guard on a
  # commit no agent may repair, so the branch is dead either way; the useful
  # thing is to say which of the two happened.
  if git diff --quiet "origin/$BRANCH...HEAD" -- "${FROZEN[@]}" 2>/dev/null; then
    echo "--- push rejected as non-fast-forward; rebasing onto origin/$BRANCH and retrying once ---" >> "$LOG"
    if git rebase "origin/$BRANCH" >> "$LOG" 2>&1; then
      SEEN="$(remote_sha)"
      if attempt; then
        exit 0
      fi
    else
      # Leave the tree as we found it; a half-applied rebase is worse than a
      # rejected push, and the caller is about to quote the log to a human.
      git rebase --abort >> "$LOG" 2>&1 || true
      echo "--- rebase onto origin/$BRANCH conflicted; not retried ---" >> "$LOG"
    fi
  else
    echo "--- origin/$BRANCH was restarted while this run was working: our unpushed commits carry their own copy of the frozen contract, so rebasing onto it would duplicate the spec rather than reconcile it. Not retried. ---" >> "$LOG"
  fi
fi

exit 1
