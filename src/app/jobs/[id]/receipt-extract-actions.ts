"use server";

import { createClient } from "@/lib/supabase/server";
import { extractReceiptFields, type ExtractedReceiptData } from "@/lib/receipt-extraction";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Extract receipt data from a photo URL.
 * Fetches a signed URL from Supabase storage and calls Claude vision API.
 * Does NOT write to the database — returns draft data only.
 *
 * @param photoUrl - The storage path (e.g. "{auth.uid()}/{cost-id}.jpg")
 * @returns Extracted receipt data with sanity bounds applied
 */
export const extractReceiptData = async (
  photoUrl: string,
): Promise<Result<ExtractedReceiptData>> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  try {
    // Generate a signed URL for the photo (1 hour expiry)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("receipts")
      .createSignedUrl(photoUrl, 3600);

    if (signedError || !signedData?.signedUrl) {
      return { ok: false, error: "Failed to generate signed URL for photo." };
    }

    // Call the extraction service
    const extracted = await extractReceiptFields(signedData.signedUrl);

    return { ok: true, data: extracted };
  } catch (error) {
    console.error("Receipt extraction error:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Extraction failed.",
    };
  }
};

/**
 * Get a signed URL for viewing a receipt photo.
 * Used by the receipt viewer to display the photo.
 *
 * @param evidenceUrl - The storage path to the receipt photo
 * @returns A signed URL valid for 1 hour
 */
export const getReceiptSignedUrl = async (
  evidenceUrl: string,
): Promise<Result<{ signedUrl: string }>> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  try {
    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(evidenceUrl, 3600);

    if (error || !data?.signedUrl) {
      return { ok: false, error: "Failed to generate signed URL." };
    }

    return { ok: true, data: { signedUrl: data.signedUrl } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to get signed URL.",
    };
  }
};
