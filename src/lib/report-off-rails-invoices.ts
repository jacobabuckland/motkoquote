import type { SupabaseClient } from "@supabase/supabase-js";

type ValueBand = {
  count: number;
  totalValue: number;
};

type Report = {
  totalCount: number;
  totalValue: number;
  bands: {
    "£0-£2,500": ValueBand;
    "£2,501-£5,000": ValueBand;
    "£5,001-£10,000": ValueBand;
    "£10,001-£25,000": ValueBand;
    "£25,001+": ValueBand;
  };
};

export async function reportOffRailsInvoices(
  supabase: SupabaseClient
): Promise<Report> {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, amount, status, payment_method, paid_at, quote:quotes(job:jobs(payment_provider_ref))")
    .eq("status", "paid");

  if (error) {
    throw new Error(`Failed to query invoices: ${error.message}`);
  }

  const cutoffDate = new Date("2026-08-15T00:00:00Z");

  const offRailsInvoices = (invoices || []).filter((invoice) => {
    // Exclude invoices paid via Stripe
    if (invoice.payment_method === "stripe_bank") {
      return false;
    }

    // Exclude legacy TrueLayer invoices by payment_method
    if (invoice.payment_method === "motko_bank") {
      return false;
    }

    // Exclude pre-migration null payment_method invoices
    if (invoice.payment_method === null && invoice.paid_at) {
      const paidAt = new Date(invoice.paid_at);
      if (paidAt < cutoffDate) {
        return false;
      }
    }

    return true;
  });

  const bands: Report["bands"] = {
    "£0-£2,500": { count: 0, totalValue: 0 },
    "£2,501-£5,000": { count: 0, totalValue: 0 },
    "£5,001-£10,000": { count: 0, totalValue: 0 },
    "£10,001-£25,000": { count: 0, totalValue: 0 },
    "£25,001+": { count: 0, totalValue: 0 },
  };

  let totalCount = 0;
  let totalValue = 0;

  for (const invoice of offRailsInvoices) {
    const amount = invoice.amount;
    totalCount++;
    totalValue += amount;

    if (amount <= 2500) {
      bands["£0-£2,500"].count++;
      bands["£0-£2,500"].totalValue += amount;
    } else if (amount <= 5000) {
      bands["£2,501-£5,000"].count++;
      bands["£2,501-£5,000"].totalValue += amount;
    } else if (amount <= 10000) {
      bands["£5,001-£10,000"].count++;
      bands["£5,001-£10,000"].totalValue += amount;
    } else if (amount <= 25000) {
      bands["£10,001-£25,000"].count++;
      bands["£10,001-£25,000"].totalValue += amount;
    } else {
      bands["£25,001+"].count++;
      bands["£25,001+"].totalValue += amount;
    }
  }

  return {
    totalCount,
    totalValue,
    bands,
  };
}
