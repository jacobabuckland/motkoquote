#!/usr/bin/env bash
#
# Read a factory issue body on stdin, print the Notion page id it refers to.
#
#   printf '%s' "$ISSUE_BODY" | scripts/factory/notion-page-id.sh
#
# Exits 1 with no output when the body names no Notion page — which is the
# normal case for an issue filed directly on GitHub rather than by the poller.
#
# WHY THERE ARE TWO SOURCES.
#
# The poller writes an HTML-comment marker at the end of the body:
#
#   <!-- notion-page-id: 3ca1e4f908b48113ba33d497bb339cce -->
#
# and every write-back used to read only that. But a card body is EDITED as a
# normal part of running this factory — a PM derivation fails, the card is the
# defect, and the body is rewritten to say so. Whoever rewrites it works from
# the rendered issue, where an HTML comment is invisible, so the marker is
# dropped without anyone seeing it go.
#
# The write-back then finds no id and exits 0 with "skipping write-back". The
# item ships, GitHub says shipped, and Notion still says Blocked — silently,
# for ever, because nothing downstream ever looks again.
#
# On 30 Aug that had happened to four items (#403, #436, #438, #443). The two
# whose bodies had never been edited (#419, #424) were correct, which is what
# identified the cause.
#
# So the first line of the body is the second source. The poller writes it too:
#
#   **Source:** [Notion roadmap item](https://app.notion.com/p/Some-Title-3ca1e4f908b48113ba33d497bb339cce)
#
# It is a visible markdown link, so an editor rewriting the card keeps it — and
# every id the marker would have carried is already in it.

set -uo pipefail

BODY="$(cat)"

# The marker first: it is unambiguous and is what the poller intends.
ID="$(printf '%s' "$BODY" \
  | grep -oE 'notion-page-id: [0-9a-fA-F-]{32,36}' \
  | head -1 | cut -d' ' -f2)"

if [ -z "$ID" ]; then
  # Fall back to the Source link. Take the id from the END of the URL path —
  # a Notion page URL is <slugified-title>-<32 hex>, and a title can itself
  # contain a hex-looking run, so anchor on the trailing one before the ")".
  ID="$(printf '%s' "$BODY" \
    | grep -oE '\(https://[^)]*notion\.[a-z]+/[^)]*\)' \
    | head -1 \
    | grep -oE '[0-9a-fA-F]{32}' \
    | tail -1)"
fi

if [ -z "$ID" ]; then
  exit 1
fi

printf '%s\n' "$ID"
