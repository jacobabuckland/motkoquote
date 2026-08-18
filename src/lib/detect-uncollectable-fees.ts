import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverLostFees, type LostFeeReport } from "@/lib/recover-lost-fees";

// Six months in milliseconds, for flagging very old fees
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

export type StrandedCollectionsReport = {
  count: number;
  totalGrossPennies: number;
  totalNetPennies: number;
  totalVatPennies: number;
  affectedContractorIds: string[];
  veryOldCollections: number; // collections created > 6 months ago
};

export type UncollectableFeesReport = {
  lostFeesFromPartialSettlement: LostFeeReport;
  strandedPendingCollections: StrandedCollectionsReport;
  totalGrossPennies: number;
  totalAffectedContractors: number;
  totalAffectedJobs: number;
  message: string;
  timestamp: string;
};

/**
 * Detects fee collections that can never be charged:
 * - status = 'pending'
 *
 * These are collections created by backfills or early VRP attempts that never
 * reached TrueLayer, OR in-flight TrueLayer charges that never completed before
 * PAY-5 removed the rail. Zero-value collections (gross_pennies = 0) are excluded
 * from the report entirely.
 */
export const detectStrandedFeeCollections = async (
  admin: SupabaseClient,
): Promise<StrandedCollectionsReport> => {
  const { data: collections, error } = await admin
    .from("fee_collections")
    .select("id, contractor_id, gross_pennies, net_pennies, vat_pennies, created_at")
    .eq("status", "pending");

  if (error) throw error;

  if (!collections || collections.length === 0) {
    return {
      count: 0,
      totalGrossPennies: 0,
      totalNetPennies: 0,
      totalVatPennies: 0,
      affectedContractorIds: [],
      veryOldCollections: 0,
    };
  }

  // Filter out zero-value collections (free jobs batches)
  const nonZeroCollections = collections.filter(
    (c) => (c.gross_pennies as number) > 0,
  );

  const now = Date.now();
  const contractorIds = new Set<string>();
  let veryOldCount = 0;

  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;

  for (const collection of nonZeroCollections) {
    totalGross += collection.gross_pennies as number;
    totalNet += (collection.net_pennies as number) || 0;
    totalVat += (collection.vat_pennies as number) || 0;
    contractorIds.add(collection.contractor_id as string);

    // Check if collection is very old (> 6 months)
    if (collection.created_at) {
      const createdAt = new Date(collection.created_at as string);
      const ageMs = now - createdAt.getTime();
      if (ageMs > SIX_MONTHS_MS) {
        veryOldCount++;
      }
    }
  }

  return {
    count: nonZeroCollections.length,
    totalGrossPennies: totalGross,
    totalNetPennies: totalNet,
    totalVatPennies: totalVat,
    affectedContractorIds: Array.from(contractorIds),
    veryOldCollections: veryOldCount,
  };
};

/**
 * Aggregates uncollectable fees from all sources:
 * - Lost fees from partial settlement (via recoverLostFees)
 * - Stranded pending collections (via detectStrandedFeeCollections)
 *
 * Returns a unified report with totals across all sources, deduplicating
 * contractor counts.
 */
export const aggregateUncollectableFees = async (
  admin: SupabaseClient,
): Promise<UncollectableFeesReport> => {
  // Call recoverLostFees in dry-run mode (no contractorId)
  const lostFees = await recoverLostFees(admin);

  // Detect stranded collections
  const strandedCollections = await detectStrandedFeeCollections(admin);

  // Sum gross pennies from both sources
  const lostFeesGross = lostFees.contractors.reduce(
    (sum, c) => sum + c.totalRecoveredFeePennies,
    0,
  );
  const totalGrossPennies = lostFeesGross + strandedCollections.totalGrossPennies;

  // Deduplicate contractor count across both sources
  const allContractorIds = new Set<string>();
  lostFees.contractors.forEach((c) => allContractorIds.add(c.contractorId));
  strandedCollections.affectedContractorIds.forEach((id) => allContractorIds.add(id));
  const totalAffectedContractors = allContractorIds.size;

  // Count total affected jobs (jobs from lostFees + collections from stranded)
  const totalAffectedJobs =
    lostFees.totalAffectedJobs + strandedCollections.count;

  // Generate human-readable summary message
  let message: string;
  if (totalGrossPennies === 0) {
    message = "No uncollectable fees detected";
  } else {
    const grossPounds = (totalGrossPennies / 100).toFixed(2);
    const contractorWord = totalAffectedContractors === 1 ? "contractor" : "contractors";
    const jobWord = totalAffectedJobs === 1 ? "job" : "jobs";

    message = `Found £${grossPounds} in uncollectable fees across ${totalAffectedContractors} ${contractorWord} and ${totalAffectedJobs} ${jobWord}`;

    // Add breakdown by source
    const lostFeePounds = (lostFeesGross / 100).toFixed(2);
    const strandedPounds = (strandedCollections.totalGrossPennies / 100).toFixed(2);
    message += ` (£${lostFeePounds} from partial settlement, £${strandedPounds} from stranded collections)`;

    // Note that sources may overlap (edge case 2, spec line 86-88)
    message += ". Note: totals may overlap if the same job appears in multiple sources.";
  }

  return {
    lostFeesFromPartialSettlement: lostFees,
    strandedPendingCollections: strandedCollections,
    totalGrossPennies,
    totalAffectedContractors,
    totalAffectedJobs,
    message,
    timestamp: new Date().toISOString(),
  };
};
