import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Type definitions for the verdict system
export interface VerdictCriterion {
  file: string;
  lineRange: string;
  name: string;
  status: "satisfied" | "failed";
}

export interface VerdictFinding {
  criterion: string;
  file: string;
  lineRange: string;
  message: string;
}

export interface Verdict {
  cycle: number;
  commit: string;
  criteria: VerdictCriterion[];
  findings: VerdictFinding[];
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

/**
 * Extract verdict blocks from issue comments.
 * Parses HTML comment blocks like <!-- qa-verdict-N {...} --> and returns the JSON.
 */
export async function extractVerdicts(
  comments: Array<{ body: string }>,
): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];

  for (const comment of comments) {
    // Match HTML comment blocks: <!-- qa-verdict-N {...json...} -->
    const regex = /<!--\s*qa-verdict-\d+\s+(\{[\s\S]*?\})\s*-->/g;
    let match;

    while ((match = regex.exec(comment.body)) !== null) {
      try {
        const verdictJson = match[1];
        const verdict = JSON.parse(verdictJson) as Verdict;
        verdicts.push(verdict);
      } catch (error) {
        // Fail open: if JSON is malformed, skip this verdict
        // Log error in production workflow, but here just continue
        console.error("Failed to parse verdict JSON:", error);
      }
    }
  }

  return verdicts;
}

/**
 * Validate a finding against prior verdicts.
 * Checks if the finding re-raises a settled criterion without valid justification.
 */
export async function validateFinding(
  finding: VerdictFinding,
  priorVerdict: Verdict,
  currentCommit: string,
  gitDiffOutput: string,
): Promise<ValidationResult> {
  // Check if this finding re-raises a criterion that was satisfied in the prior verdict
  const settledCriterion = priorVerdict.criteria.find(
    (c) =>
      c.name === finding.criterion &&
      c.file === finding.file &&
      c.status === "satisfied",
  );

  // If not a re-raise, it's a new finding - accept it
  if (!settledCriterion) {
    return {
      valid: true,
      reason: "new finding (not in prior satisfied criteria)",
    };
  }

  // This is a re-raise. Check if the code region changed.
  const codeChanged = gitDiffOutput.trim().length > 0;

  if (!codeChanged) {
    return {
      valid: false,
      reason: `unchanged since cycle ${priorVerdict.cycle}`,
    };
  }

  // Code changed, but does the finding name what changed?
  // Check for keywords that indicate the finding references the change
  const changeKeywords = [
    "changed",
    "modified",
    "updated",
    "now",
    "became",
    "switched",
    "added",
    "removed",
    "replaced",
    "at line",
  ];

  const messageContainsChangeReference = changeKeywords.some((keyword) =>
    finding.message.toLowerCase().includes(keyword),
  );

  if (!messageContainsChangeReference) {
    return {
      valid: false,
      reason:
        "does not name what changed (re-raised finding must reference specific code change)",
    };
  }

  return {
    valid: true,
    reason: "code changed and finding names the change",
  };
}

/**
 * Format a verdict as an HTML comment block for appending to issue comments.
 */
export function appendVerdictBlock(verdict: Verdict): string {
  const json = JSON.stringify(verdict);
  return `<!-- qa-verdict-${verdict.cycle} ${json} -->`;
}

/**
 * Check if a file region changed between two commits.
 */
export async function checkRegionChanged(
  repoPath: string,
  file: string,
  priorCommit: string,
  currentCommit: string,
): Promise<boolean> {
  try {
    // Escape shell arguments to prevent command injection
    const escapeShellArg = (arg: string): string => {
      return `'${arg.replace(/'/g, "'\\''")}'`;
    };

    const { stdout } = await execAsync(
      `git -C ${escapeShellArg(repoPath)} diff ${escapeShellArg(priorCommit)}..${escapeShellArg(currentCommit)} -- ${escapeShellArg(file)}`,
    );
    return stdout.trim().length > 0;
  } catch (error) {
    // If git diff fails, fail open (assume changed)
    console.error("Git diff failed:", error);
    return true;
  }
}

/**
 * Filter out verdicts with commits that don't exist in current branch history.
 */
export async function filterStaleVerdicts(
  verdicts: Verdict[],
  existingCommits: string[],
): Promise<Verdict[]> {
  return verdicts.filter((verdict) => existingCommits.includes(verdict.commit));
}

/**
 * Rewrite verdict from CHANGES to PASS if all findings are invalid.
 * Returns true if the verdict was rewritten, false otherwise.
 */
export async function rewriteVerdictIfAllInvalid(
  initialVerdict: string,
  validationResults: ValidationResult[],
): Promise<boolean> {
  // Check if all findings are invalid
  const allInvalid = validationResults.every((result) => !result.valid);

  if (allInvalid && validationResults.length > 0) {
    // Should rewrite the verdict
    return true;
  }

  return false;
}
