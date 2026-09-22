#!/usr/bin/env bash
#
# Fails when a recorded prompt no longer matches the prompt this tree produces.
#
# WHY THIS EXISTS RATHER THAN `npm run test:pipeline` IN CI. The pipeline suite
# has a standing failure — scenario-1's compile stage, red since 3 Sep, where
# the drafter merges the labour lines and the transcript's £1,400 tiling labour
# and £140 radiator swap reach no line. That is a real product defect and it is
# tracked as one. Wiring the whole suite in today would block every merge on it,
# and a gate that has to be bypassed on day one is not a gate.
#
# So this checks the ONE thing that is green today and was silently red for two
# days: whether the recordings still belong to the prompts. #833 reworded the
# SoW-narrative prompt on 19 Sep and orphaned scenario-1-narrative.json; nothing
# said so until a human ran the suite by hand on 21 Sep, and re-recording it
# then took four attempts. Run here, it would have failed on #833's own pull
# request, beside the change that caused it.
#
# It deliberately tolerates every other failure. A staleness failure means a
# fixture must be re-recorded; anything else is the harness reporting on the
# product, which is the suite's job and not this gate's. When compile goes
# green, replace this with the suite itself.
#
# Needs no ANTHROPIC_API_KEY: replay mode reads from disk. Re-recording does
# need one, which is why this can never fix what it finds — it can only say so.
set -uo pipefail

cd "$(dirname "$0")/.."

# Read the marker from the recorder rather than repeating its wording here. A
# reworded message would otherwise leave this grep matching nothing and the gate
# passing on exactly the failure it is for.
MARKER=$(npx tsx -e \
  'import { PROMPT_HASH_MISMATCH } from "./tests/helpers/anthropic-recorder"; process.stdout.write(PROMPT_HASH_MISMATCH)')
if [ -z "$MARKER" ]; then
  echo "::error::Could not read PROMPT_HASH_MISMATCH from tests/helpers/anthropic-recorder.ts."
  exit 1
fi

OUTPUT=$(npm run --silent test:pipeline 2>&1)

if printf '%s' "$OUTPUT" | grep -qF "$MARKER"; then
  echo "::error::A recorded prompt is stale. Re-record the fixtures against this tree."
  printf '%s\n' "$OUTPUT" | grep -F -A 4 "$MARKER"
  echo ""
  echo "To fix, on a machine holding ANTHROPIC_API_KEY:"
  echo "  rm fixtures/pipeline/recordings/*.json"
  echo "  RECORD_PIPELINE=1 npm run test:pipeline"
  echo "  npm run test:pipeline   # verify the replay"
  exit 1
fi

echo "Pipeline recordings match the prompts in this tree."
