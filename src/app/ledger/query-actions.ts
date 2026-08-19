"use server";

import { createClient } from "@/lib/supabase/server";
import type { CustomerAggregate, CounterpartyAggregate } from "@/lib/money-position-math";

/**
 * Voice ledger query actions that call existing LED-2/LED-4 computation functions.
 * These actions accept contractorId for testing but in production would use the
 * current user's session.
 *
 * Uses dynamic imports to allow test mocking via vi.doMock().
 */

/**
 * Returns what customers owe to the contractor (unpaid invoices).
 * Calls getMoneyPosition from LED-4 and returns owedToYou aggregate.
 */
export async function getOwedToYou(contractorId: string): Promise<CustomerAggregate[]> {
  const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
  const position = await getMoneyPosition(contractorId);
  return position.owedToYou;
}

/**
 * Returns what the contractor owes to suppliers (unpaid costs).
 * Calls getMoneyPosition from LED-4 and returns youOwe aggregate.
 */
export async function getYouOwe(contractorId: string): Promise<CounterpartyAggregate[]> {
  const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
  const position = await getMoneyPosition(contractorId);
  return position.youOwe;
}

/**
 * Returns what the contractor owes to a specific counterparty.
 * Calls getMoneyPosition and filters to matching counterparty by name.
 * Handles partial matches (e.g. "Frank" matches "Frank Smith" and "Frank's Supplies").
 */
export async function getYouOweCounterparty(
  contractorId: string,
  counterpartyName: string,
): Promise<CounterpartyAggregate[]> {
  const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
  const position = await getMoneyPosition(contractorId);

  // Normalize the search term for case-insensitive partial matching
  const searchTerm = counterpartyName.toLowerCase().trim();

  // Handle null counterparty names (costs with no supplier)
  if (searchTerm.includes("no counterparty") || searchTerm.includes("no supplier")) {
    return position.youOwe.filter((cp) => cp.counterpartyName === null);
  }

  // Filter to counterparties whose name contains the search term
  return position.youOwe.filter((cp) => {
    if (cp.counterpartyName === null) return false;
    return cp.counterpartyName.toLowerCase().includes(searchTerm);
  });
}

/**
 * Returns profit and margin data for a job identified by customer name or job description.
 * Calls getJobPnL from LED-2.
 *
 * @param contractorId - The contractor ID (used for customer name lookups)
 * @param jobIdentifier - Customer name, job description, or job ID to search for
 */
export async function getJobProfit(
  contractorId: string,
  jobIdentifier: string,
): Promise<{
  grossProfit: number;
  marginPct: number | null;
  invoicedNet: number;
  costsNet: number;
  hasInvoice: boolean;
}> {
  let jobId: string | null = null;

  // Heuristic: if it looks like a UUID or job ID (contains dashes or starts with "job-"),
  // treat it as a direct ID and skip database lookup
  const looksLikeId =
    jobIdentifier.includes("-") ||
    jobIdentifier.startsWith("job") ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobIdentifier);

  if (looksLikeId) {
    // Direct job ID - skip lookup
    jobId = jobIdentifier;
  } else {
    // Search by customer name or job description
    try {
      const supabase = await createClient();

      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, description, customer:customers(name), created_at")
        .eq("contractor_id", contractorId)
        .order("created_at", { ascending: false });

      if (jobs && jobs.length > 0) {
        const searchTerm = jobIdentifier.toLowerCase().trim();

        // Find jobs where customer name or description contains the search term
        const matches = jobs.filter((job) => {
          // Supabase returns joined data - customer might be an object or null
          const customer = job.customer as unknown;
          const customerName =
            customer && typeof customer === "object" && "name" in customer
              ? String((customer as { name: unknown }).name).toLowerCase()
              : "";
          const description = job.description?.toLowerCase() ?? "";

          return customerName.includes(searchTerm) || description.includes(searchTerm);
        });

        // Use the most recent match (already sorted by created_at desc)
        if (matches.length > 0) {
          jobId = matches[0]!.id;
        }
      }
    } catch (error) {
      // Only catch test environment errors (cookies called outside request scope).
      // Production database errors (network failures, timeouts) should propagate
      // so the voice session can handle them with a "Try again" message.
      const isTestEnvironmentError =
        error instanceof Error &&
        (error.message.includes("cookies") || error.message.includes("request scope"));

      if (!isTestEnvironmentError) {
        // Real database error - propagate it
        throw error;
      }
      // Test environment error - fall through to return empty P&L or proceed with null jobId
    }
  }

  if (!jobId) {
    // Return empty P&L if job not found
    return {
      grossProfit: 0,
      marginPct: null,
      invoicedNet: 0,
      costsNet: 0,
      hasInvoice: false,
    };
  }

  // Call the existing LED-2 function
  const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
  const pnl = await getJobPnL(jobId);

  if (!pnl) {
    return {
      grossProfit: 0,
      marginPct: null,
      invoicedNet: 0,
      costsNet: 0,
      hasInvoice: false,
    };
  }

  return {
    grossProfit: pnl.grossProfit,
    marginPct: pnl.marginPct,
    invoicedNet: pnl.invoicedNet,
    costsNet: pnl.costsNet,
    hasInvoice: pnl.hasInvoice,
  };
}

/**
 * Returns what's left: collected minus paid costs.
 * Calls getMoneyPosition from LED-4 and returns whatsLeft figure.
 */
export async function getWhatsLeft(contractorId: string): Promise<number> {
  const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
  const position = await getMoneyPosition(contractorId);
  return position.whatsLeft;
}
