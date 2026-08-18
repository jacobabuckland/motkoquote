import { parseSpokenAmount } from "./parse-amount";
import { matchJobByCustomerName } from "./match-job";

export interface ExtractedCost {
  amount_net: number;
  counterparty_name?: string;
  category: string;
  job_id?: string;
  multipleAmountsDetected?: boolean;
}

/**
 * Extracts cost information from a voice transcript.
 * Does NOT write to the database - returns structured data for confirmation.
 */
export async function extractCostFromTranscript(
  transcript: string,
  contractorId: string
): Promise<ExtractedCost | null> {
  if (!transcript) {
    return null;
  }

  const normalized = transcript.toLowerCase();

  // Detect multiple amounts - look for patterns like "X at Y and Z at W"
  const multipleAmountPatterns = [
    /\b(?:and|then)\s+(?:another|also)\s+/,
    /\bat\s+\w+\s+and\s+(?:at\s+)?\w+/,
    /\d+.*\band\s+(?:another\s+)?\d+/,
  ];

  for (const pattern of multipleAmountPatterns) {
    if (pattern.test(normalized)) {
      // Multiple amounts detected - amount_net is omitted (undefined)
      return {
        category: "materials",
        multipleAmountsDetected: true,
      } as unknown as ExtractedCost;
    }
  }

  // Extract amount using the deterministic parser
  const amount = parseSpokenAmount(transcript);
  if (amount === null) {
    return null;
  }

  // Extract category from keywords
  let category = "materials"; // Default
  if (/\b(labour|labor|work|hours?)\b/i.test(transcript)) {
    category = "labour";
  } else if (/\b(subcontractor|subbie)\b/i.test(transcript)) {
    category = "subcontractor";
  } else if (/\b(plant|hire|rental|equipment)\b/i.test(transcript)) {
    category = "plant_hire";
  } else if (/\b(materials?|supplies?)\b/i.test(transcript)) {
    category = "materials";
  }

  // Extract counterparty name - look for "at X" pattern
  let counterpartyName: string | undefined;
  const atMatch = transcript.match(/\bat\s+([A-Z][A-Za-z&\s]+?)(?:\s+for|\s+on|$)/i);
  if (atMatch && atMatch[1]) {
    counterpartyName = atMatch[1].trim();
  }

  // Extract customer/job reference - look for "for the X job" or "for X"
  let jobId: string | undefined;
  const forMatch = transcript.match(/\bfor\s+(?:the\s+)?([A-Z][A-Za-z\s]+?)(?:\s+job)?(?:\s+on|$)/i);
  if (forMatch && forMatch[1]) {
    const customerNameMatch = forMatch[1].trim();
    // Try to match a job by this customer name
    const jobs = await matchJobByCustomerName(contractorId, customerNameMatch);
    if (jobs.length === 1) {
      jobId = jobs[0]?.id;
    } else if (jobs.length > 1) {
      // Multiple matches - return the first for now (UI should handle disambiguation)
      jobId = jobs[0]?.id;
    }
  }

  return {
    amount_net: amount,
    counterparty_name: counterpartyName,
    category,
    job_id: jobId,
  };
}
