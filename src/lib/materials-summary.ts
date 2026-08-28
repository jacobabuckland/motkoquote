// What the Materials block on a document should say, given both sources.
//
// There are two: `materials_mentioned`, a flat list of everything named during
// the call, and `materials_supply`, the same materials attributed to whoever is
// supplying them (checklist question 3). The statement of work rendered both
// in full, so a material named once and then attributed printed TWICE — once
// bare and once under "Supplied by us:". On the reviewed job the entire
// materials list appeared twice in one panel.
//
// The attributed form is strictly more informative, so it wins. Only materials
// that were never attributed to anybody are worth stating on their own, and
// they are stated without an implied supplier — inventing one is the failure
// this whole review is about.

import type { MaterialsSupply } from "@/lib/schemas/job";

// Matching is on a normalised form so "Copper pipe and fittings." and "copper
// pipe and fittings" are one material, not two. Deliberately conservative: it
// folds case, surrounding space and a trailing full stop, and nothing else. A
// looser match would silently drop a material the contractor did name, which is
// worse than printing one twice.
const normalize = (material: string): string =>
  material.trim().toLowerCase().replace(/\.$/, "");

export type MaterialsSummary = {
  /** Materials named but attributed to nobody. Rendered as a plain sentence. */
  unattributed: string[];
  /** The attributed sentence ("Supplied by us: …"), or null when nothing is attributed. */
  supplySentence: string | null;
};

export const materialsSummary = (
  mentioned: string[],
  supply: MaterialsSupply | null | undefined,
): MaterialsSummary => {
  const contractorSupplied = supply?.contractor_supplied ?? [];
  const customerSupplied = supply?.customer_supplied ?? [];

  const attributed = new Set(
    [...contractorSupplied, ...customerSupplied].map(normalize),
  );

  const unattributed = mentioned.filter(
    (material) => !attributed.has(normalize(material)),
  );

  const parts: string[] = [];
  if (contractorSupplied.length > 0) {
    parts.push(`Supplied by us: ${contractorSupplied.join(", ")}`);
  }
  if (customerSupplied.length > 0) {
    parts.push(`Supplied by customer: ${customerSupplied.join(", ")}`);
  }

  return {
    unattributed,
    supplySentence: parts.length > 0 ? `${parts.join(". ")}.` : null,
  };
};
