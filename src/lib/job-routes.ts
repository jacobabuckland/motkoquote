/**
 * Routing helpers for job-related pages.
 */

/**
 * Returns the path to a job's quote editor page.
 *
 * @param jobId - The job ID
 * @returns The path to the quote route, e.g. `/jobs/job_abc123/quote`
 */
export function jobQuoteHref(jobId: string): string {
  return `/jobs/${jobId}/quote`;
}
