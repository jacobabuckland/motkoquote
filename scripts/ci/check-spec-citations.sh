#!/usr/bin/env bash
set -euo pipefail

# A specification may not cite a document that is not in the tree.
#
#   scripts/ci/check-spec-citations.sh
#
# Extracts backticked `*.md` references from the LIVE specification documents,
# resolves each against the repository root, and fails naming any that does not
# resolve.
#
# WHY. The rule existed in prose and was broken by the person who wrote it: a
# draft introduced "a failing citation is fixed by committing the document,
# never by removing the backticks" and, one section later, converted three
# backticked citations to prose. On 5 Sep this check's first real run found four
# citations in docs/specs/motko-pre-launch-spec.md —
# stripe-connect-activation-spec.md, pricing-review-aug-2026.md,
# quote-flow-defects-aug-2026.md and motko-robustness-addendum-1-sep-2026.md —
# none of which had ever been a file. They were review passes whose titles
# propagated into prose as if they were paths.
#
# The check NAMES the unresolved path and stops. It must never prescribe the
# repair: "commit the document" and "remove the citation" are both valid — the
# second when the document never existed — and no check can tell them apart.

if [ ! -d "docs/specs" ]; then
  # No specs directory, nothing to check.
  exit 0
fi

missing=$(mktemp)
trap 'rm -f "$missing"' EXIT

# WHICH FILES ARE SCANNED, AND WHY IT IS NOT ALL OF THEM.
#
# Only the live specification documents. The per-issue records — docs/specs/1.md,
# 593.md and the hundred others named for their issue number — are written once
# at derivation and frozen by the spec-immutability job. A citation inside one of
# those cannot be repaired by anybody, ever, so reporting it can never change
# behaviour: it is noise that no run can act on. AGENTS.md says a signal that
# must change behaviour cannot terminate in telemetry; the corollary is that a
# signal which cannot change behaviour should not fire at all.
#
# This is not an escape hatch and it is not a list. It is one categorical
# distinction — frozen historical record versus live document — applied by shape
# of filename, so a new per-issue spec is covered the day it is written and a new
# live document is scanned the day it is added. Never add a named file to an
# exclusion list here; if a live document cites something missing, the citation
# is the thing to fix.
#
# It also matters that this item could not otherwise ship. docs/specs/593.md is
# the frozen spec for this very check, and it uses realistic .md names as
# illustrative examples — line 49 requires the check to flag `spec.md`, in a
# sentence containing `spec.md`. Scanning it makes the check permanently red on
# its own repository with no legal repair.
while IFS= read -r spec; do
  base=$(basename "$spec")
  # A per-issue record: digits then .md, e.g. 593.md. Skip it.
  case "$base" in
    *[!0-9]*.md) ;;   # has a non-digit before .md — a live document, scan it
    *.md) continue ;; # purely numeric — a frozen per-issue record
  esac

  # Collected before the loop rather than piped into it. grep exits 1 when a
  # document contains no backticked citation at all — the common case, and not
  # an error — and under `set -o pipefail` that status becomes the pipeline's,
  # which `set -e` then treats as a failed check. A check that reports failure
  # because a file was clean is worse than no check.
  matches=$(grep -o '`[^`]*\.md`' "$spec" 2>/dev/null | sort -u || true)
  [ -z "$matches" ] && continue

  while IFS= read -r match; do
    cited_path=${match#\`}
    cited_path=${cited_path%\`}

    [ -z "$cited_path" ] && continue
    # A bare extension is not a path.
    [ "$cited_path" = ".md" ] && continue
    # A glob is a pattern, not a path: `*.md` in prose describes the shape of a
    # citation rather than naming one.
    case "$cited_path" in
      *"*"* | *"?"* | *"["*) continue ;;
    esac

    if [ ! -f "$cited_path" ]; then
      echo "$cited_path (cited in $spec)" >> "$missing"
    fi
  done <<< "$matches"
done < <(find docs/specs -type f -name "*.md")

if [ -s "$missing" ]; then
  echo "Unresolved document citations:" >&2
  sort -u "$missing" >&2
  exit 1
fi

exit 0
