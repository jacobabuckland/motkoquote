import { createAdminClient } from "@/lib/supabase/admin";
import type { LineItem } from "@/lib/schemas/job";

export type KnownMaterialPrice = {
  description: string;
  unit: string | null;
  unit_price: number;
};

const sanitizeForIlike = (term: string): string =>
  term.replace(/[,()%_]/g, "").trim();

// Best-effort: remember contractor-confirmed material prices (saved from the
// quote editor) keyed by description, so future drafts can reuse them.
export const rememberMaterialPrices = async (
  contractorId: string,
  lineItems: LineItem[],
): Promise<void> => {
  try {
    const materials = lineItems.filter(
      (item) =>
        item.category === "materials" &&
        item.description.trim().length > 0 &&
        item.unit_price > 0,
    );
    if (materials.length === 0) return;

    const admin = createAdminClient();
    const rows = materials.map((item) => ({
      contractor_id: contractorId,
      description: item.description.trim(),
      unit: item.unit,
      unit_price: item.unit_price,
      confirmed_at: new Date().toISOString(),
    }));

    await admin
      .from("contractor_material_prices")
      .upsert(rows, { onConflict: "contractor_id,normalized_description" });
  } catch {
    // Material price memory is best-effort — never block saving the quote.
  }
};

export const findKnownMaterialPrices = async (
  contractorId: string,
  materialsMentioned: string[],
): Promise<KnownMaterialPrice[]> => {
  const terms = materialsMentioned.map(sanitizeForIlike).filter(Boolean);
  if (terms.length === 0) return [];

  try {
    const admin = createAdminClient();
    const orFilter = terms.map((term) => `description.ilike.%${term}%`).join(",");

    const { data, error } = await admin
      .from("contractor_material_prices")
      .select("description, unit, unit_price")
      .eq("contractor_id", contractorId)
      .or(orFilter)
      .limit(10);

    if (error || !data) return [];
    return data as KnownMaterialPrice[];
  } catch {
    return [];
  }
};
