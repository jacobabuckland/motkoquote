/**
 * Match a spoken job reference to an existing job.
 *
 * Matches by:
 * 1. Customer name (case-insensitive)
 * 2. Job reference (e.g. "MK-1234")
 * 3. Recency hints ("the last job", "most recent")
 *
 * Returns:
 * - A single JobSummary when exactly one job matches
 * - "ambiguous" when multiple jobs match
 * - null when no jobs match
 */

export type JobSummary = {
  id: string;
  customer_name: string;
  /**
   * Every field below is optional because two frozen acceptance contracts
   * disagree about this type and both must hold:
   *
   *   #258 (LED-5) constructs summaries with `job_reference` and `updated_at`,
   *   and asserts matching on both.
   *   #453 (DATA-2) constructs them with `created_at`, because `jobs` has no
   *   `job_reference` or `updated_at` column — confirmed absent on production
   *   on 30 Aug 2026 (#409).
   *
   * Neither test may be edited, so the matcher accepts either shape. In
   * practice only the #453 shape can ever arrive from the database; the
   * `job_reference` branch is unreachable with real data and is retained
   * solely because #258 asserts it.
   */
  job_reference?: string;
  updated_at?: string;
  created_at?: string;
};

/**
 * Normalize a string for matching: lowercase, trim, remove extra whitespace
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if a spoken reference is asking for the most recent job
 */
function isRecencyReference(spoken: string): boolean {
  const normalized = normalize(spoken);
  const recencyPatterns = [
    "last job",
    "most recent",
    "latest job",
    "recent job",
    "the one i finished",
    "yesterday",
  ];

  return recencyPatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Extract a potential customer name from spoken text
 * e.g. "the Henderson job" -> "henderson"
 * e.g. "Smith" -> "smith"
 */
function extractCustomerName(spoken: string): string | null {
  const normalized = normalize(spoken);

  // Remove common filler words
  const cleaned = normalized
    .replace(/\b(the|a|an|for|job|one)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Check if spoken text looks like a job reference (e.g. "MK-1234")
 */
function looksLikeJobReference(text: string): boolean {
  // Pattern: letters followed by dash/space and numbers, or just alphanumeric
  return /^[A-Z]{2,4}[-\s]?\d{3,6}$/i.test(text.trim());
}

/**
 * Match a spoken job reference to an existing job.
 *
 * Examples:
 * - "the Henderson job" -> matches customer_name containing "henderson"
 * - "MK-1001" -> matches job_reference "MK-1001"
 * - "the last job" -> matches most recent job by updated_at
 * - "the Smith job" when 3 Smith jobs exist -> returns "ambiguous"
 * - "the Jones job" when no Jones jobs exist -> returns null
 */
const recencyOf = (job: JobSummary): number => {
  const stamp = job.updated_at ?? job.created_at;
  const parsed = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
};

export function matchJobBySpokenReference(
  spoken: string,
  jobs: JobSummary[]
): JobSummary | null | "ambiguous" {
  if (jobs.length === 0) return null;

  const trimmed = spoken.trim();
  if (!trimmed) return null;

  // Check for recency reference first ("the last job", "most recent")
  if (isRecencyReference(trimmed)) {
    // `updated_at` first for the #258 shape, then `created_at` for the real
    // one. A summary carrying neither sorts last: an unknown date is not a
    // recent one, and throwing here would take the whole voice turn down.
    const sorted = [...jobs].sort(
      (a, b) => recencyOf(b) - recencyOf(a)
    );
    return sorted[0] ?? null;
  }

  // Check if it looks like a job reference (MK-1234)
  if (looksLikeJobReference(trimmed)) {
    const normalized = normalize(trimmed).replace(/[-\s]/g, "");
    const matches = jobs.filter((job) => {
      const jobRefNormalized = normalize(job.job_reference ?? "").replace(/[-\s]/g, "");
      return jobRefNormalized === normalized;
    });

    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) return "ambiguous";
    return null;
  }

  // Try to extract customer name and match
  const customerName = extractCustomerName(trimmed);
  if (!customerName) return null;

  const matches = jobs.filter((job) =>
    normalize(job.customer_name).includes(customerName)
  );

  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length > 1) return "ambiguous";
  return null;
}
