import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

type RecordedResponse = {
  requestHash: string;
  response: Anthropic.Message;
};

/**
 * Record/replay wrapper for Anthropic client calls.
 *
 * In replay mode (default), reads recorded responses from fixtures/pipeline/recordings/
 * and returns them without network access or an API key.
 *
 * In record mode (RECORD_PIPELINE=1), makes real API calls via the provided real client,
 * writes responses to disk, and fails if a recording already exists.
 */
export function createRecordedClient(
  scenarioId: string,
  stage: string,
  realClient?: unknown,
) {
  const isRecordMode = process.env.RECORD_PIPELINE === "1";
  const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
  const recordingPath = resolve(recordingsDir, `${scenarioId}-${stage}.json`);

  if (isRecordMode) {
    // Record mode: make real API calls and write to disk
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "RECORD_PIPELINE=1 requires ANTHROPIC_API_KEY to make real API calls",
      );
    }

    if (!realClient) {
      throw new Error("Record mode requires a real Anthropic client instance");
    }

    if (existsSync(recordingPath)) {
      throw new Error(
        `Recording already exists at ${recordingPath}. ` +
          `Delete it first to re-record, or unset RECORD_PIPELINE to replay.`,
      );
    }

    const client = realClient as Anthropic;

    return {
      messages: {
        create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
          const response = await client.messages.create(params);

          // Hash the request to detect prompt changes
          const requestHash = hashRequest(params);

          const recorded: RecordedResponse = {
            requestHash,
            response,
          };

          // Ensure directory exists
          if (!existsSync(recordingsDir)) {
            mkdirSync(recordingsDir, { recursive: true });
          }

          // Write the recording
          writeFileSync(recordingPath, JSON.stringify(recorded, null, 2), "utf-8");

          return response;
        },
      },
    };
  } else {
    // Replay mode: read from disk
    if (!existsSync(recordingPath)) {
      throw new Error(
        `No recording found at ${recordingPath}. ` +
          `Run with RECORD_PIPELINE=1 to create it.`,
      );
    }

    const recordingContent = readFileSync(recordingPath, "utf-8");
    const recorded = JSON.parse(recordingContent) as RecordedResponse;

    return {
      messages: {
        create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
          const currentHash = hashRequest(params);

          if (currentHash !== recorded.requestHash) {
            throw new Error(
              `Prompt hash mismatch for ${scenarioId} at stage ${stage}.\n` +
                `Expected: ${recorded.requestHash}\n` +
                `Got: ${currentHash}\n` +
                `The prompt has changed since this recording was made. ` +
                `Re-record with RECORD_PIPELINE=1 or revert the prompt change.`,
            );
          }

          return recorded.response;
        },
      },
    };
  }
}

function hashRequest(params: Anthropic.MessageCreateParamsNonStreaming): string {
  // Hash the parts of the request that matter for reproducibility
  const canonical = {
    model: params.model,
    system: params.system,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}
