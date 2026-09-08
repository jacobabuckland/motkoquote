/**
 * Parses vitest output from pipeline tests and categorizes failures.
 *
 * Distinguishes between:
 * - Prompt hash mismatches (fixtures need re-recording)
 * - Content findings (quote may not match transcript)
 */

export interface ParseResult {
  hasPromptHashMismatch: boolean;
  hasContentFindings: boolean;
  details: string[];
  summary?: string;
  failedScenarios: string[];
}

export function parseVitestOutput(output: string): ParseResult {
  const result: ParseResult = {
    hasPromptHashMismatch: false,
    hasContentFindings: false,
    details: [],
    failedScenarios: [],
  };

  if (!output || output.trim() === "") {
    return result;
  }

  // Detect prompt hash mismatch
  if (output.includes("Prompt hash mismatch")) {
    result.hasPromptHashMismatch = true;
  }

  // Detect content findings - AssertionError with bracketed scenario markers
  // These come from compareLineItems, checkStatedPricesSurvive, checkForbiddenAmounts
  const assertionErrorPattern = /AssertionError:/;
  const scenarioMarkerPattern = /\[scenario-\d+\s*·\s*\w+\]/;

  if (assertionErrorPattern.test(output) && scenarioMarkerPattern.test(output)) {
    result.hasContentFindings = true;
  }

  // Extract failure details from bracketed markers and surrounding context
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // Capture lines with scenario markers that describe failures
    if (scenarioMarkerPattern.test(trimmed)) {
      result.details.push(trimmed);
    }

    // Also capture assertion error lines
    if (trimmed.startsWith("AssertionError:") && trimmed.length > "AssertionError:".length) {
      const msg = trimmed.slice("AssertionError:".length).trim();
      if (msg) {
        result.details.push(msg);
      }
    }
  }

  // Extract scenario names from failures
  const scenarioMatches = output.matchAll(/(?:scenario-\d+|for\s+(scenario-\d+))/g);
  const scenarios = new Set<string>();
  for (const match of scenarioMatches) {
    const scenario = match[1] || match[0];
    if (scenario.startsWith("scenario-")) {
      scenarios.add(scenario);
    }
  }
  result.failedScenarios = Array.from(scenarios);

  // Build summary message
  if (result.hasPromptHashMismatch && result.hasContentFindings) {
    result.summary = "Pipeline suite has both stale recording (needs re-record) and content findings";
  } else if (result.hasPromptHashMismatch) {
    result.summary = "Pipeline suite has stale recording — re-record with RECORD_PIPELINE=1";
  } else if (result.hasContentFindings) {
    result.summary = "Pipeline suite has content findings — quote may not match what the transcript says";
  }

  return result;
}
