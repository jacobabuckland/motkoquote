import Anthropic from "@anthropic-ai/sdk";

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ExtractedReceiptData = {
  total: number | null; // pence
  supplier: string | null;
  date: string | null; // YYYY-MM-DD
  vat: number | null; // pence
};

type RawExtraction = {
  total: number | null;
  supplier: string | null;
  date: string | null;
  vat: number | null;
};

const extractJson = (text: string): unknown => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Claude response");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error("Claude response was not valid JSON");
  }
};

/**
 * Apply sanity bounds to extracted receipt data.
 * Rejects implausible values that are likely extraction errors.
 */
export const applySanityBounds = (data: RawExtraction): ExtractedReceiptData => {
  let { total, date, vat } = data;
  const { supplier } = data;

  // Total must be between £0.01 (1 pence) and £50,000.00 (5,000,000 pence)
  if (total !== null && (total < 1 || total > 5_000_000)) {
    total = null;
  }

  // Date must parse as valid
  if (date !== null) {
    const parsed = Date.parse(date);
    if (isNaN(parsed)) {
      date = null;
    }
  }

  // VAT cannot exceed total
  if (vat !== null && total !== null && vat > total) {
    vat = null;
  }

  return { total, supplier, date, vat };
};

/**
 * Build the extraction prompt for Claude vision API.
 */
export const buildExtractionPrompt = (): string => {
  return (
    "Extract from this receipt: total amount (number only), supplier name (text), " +
    "date (YYYY-MM-DD), VAT amount if legible (number only). " +
    "Return JSON: {total: number | null, supplier: string | null, date: string | null, vat: number | null}. " +
    "If any field is illegible or not present, return null for that field. " +
    "For total and vat, return the amount in pence (e.g. £45.00 = 4500). " +
    "For date, return YYYY-MM-DD format (e.g. 2026-08-15)."
  );
};

/**
 * Extract receipt data from a photo URL using Claude vision API.
 * Does NOT write to the database — returns draft data only.
 *
 * @param signedUrl - A signed URL to the receipt photo (from Supabase storage)
 * @returns Extracted receipt data with sanity bounds applied
 */
export const extractReceiptFields = async (
  signedUrl: string,
): Promise<ExtractedReceiptData> => {
  try {
    const response = await client().messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "url",
                url: signedUrl,
              },
            },
            {
              type: "text",
              text: buildExtractionPrompt(),
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const raw = extractJson(text) as RawExtraction;

    // Apply sanity bounds before returning
    return applySanityBounds(raw);
  } catch (error) {
    // Extraction failure is a normal outcome (blurry photo, non-receipt, etc.)
    // Return all nulls rather than throwing
    console.error("Receipt extraction failed:", error);
    return {
      total: null,
      supplier: null,
      date: null,
      vat: null,
    };
  }
};
