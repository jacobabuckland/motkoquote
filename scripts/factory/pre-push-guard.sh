#!/usr/bin/env bash
#
# A git pre-push hook that refuses to discard commits on a factory branch.
#
# WHY THIS EXISTS AT ALL. scripts/factory/push-branch.sh already gets this
# right: `advance` pushes without force, so a stale checkout is rejected rather
# than winning, and `--force-with-lease` is used only by `restart`, against the
# sha that run actually saw. None of that binds the agent. `actions/checkout`
# leaves credentials on the remote, so the agent inside an Engineer or QA job
# can run `git push --force` itself and bypass the script entirely —
# factory-engineer.yml records it doing precisely that on #108.
#
# The destructive case is narrow and worth naming. An Engineer or QA job holds
# a checkout for ten to fifteen minutes. If the item is re-derived inside that
# window, the PM force-pushes a NEW first commit, and a stale agent that then
# force-pushes its own work restores the superseded lineage. What it restores
# is a branch whose acceptance tests are the OLD ones — and only a first commit
# may write those, so the contract is unreachable from that point on. The item
# looks alive and cannot merge.
#
# WHAT IT ALLOWS. Everything that is not a discard. Ordinary pushes, new
# branches, and the script's own force-with-lease are all untouched: the script
# exports FACTORY_PUSH_GUARD=allow around its attempt, having already checked
# the lease. The hook only fires on a push that would drop commits the remote
# has, and only on refs/heads/factory/*.
#
# Deliberately not a blanket ban on force. `restart` legitimately rewrites a
# factory branch — that is how a re-derivation replaces a spec commit — and a
# hook that refused it would break the mechanism it is meant to protect.
set -euo pipefail

[ "${FACTORY_PUSH_GUARD:-}" = "allow" ] && exit 0

ZERO='0000000000000000000000000000000000000000'

while read -r _local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/factory/*) ;;
    *) continue ;;
  esac

  # Branch deletion, or a branch that does not exist yet. Neither discards
  # anything that is on the remote.
  [ "$local_sha" = "$ZERO" ] && continue
  [ "$remote_sha" = "$ZERO" ] && continue

  # The only question that matters: does what we are pushing still contain what
  # the remote has? If it does, this is a fast-forward and nothing is lost.
  if git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
    continue
  fi

  cat >&2 <<MSG

  REFUSED: this push would discard commits on ${remote_ref#refs/heads/}.

    remote is at  $remote_sha
    pushing       $local_sha

  The remote's commit is not an ancestor of yours, so it would be dropped.
  Almost always this means the item was re-derived while this job was running:
  the PM wrote a new first commit, and this checkout predates it.

  That matters more than a lost run. Only a branch's FIRST commit may touch
  tests/acceptance/, so restoring the older lineage restores the superseded
  acceptance tests too, and nothing downstream can repair them.

  Do not force past this. Let the run end; the item is re-deriving and this
  work is against a contract that no longer exists.

  If you are scripts/factory/push-branch.sh, you already checked the lease and
  should be running with FACTORY_PUSH_GUARD=allow.

MSG
  exit 1
done

exit 0
