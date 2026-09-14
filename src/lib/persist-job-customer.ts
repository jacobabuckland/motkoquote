import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUkPhone } from "@/lib/phone";

/**
 * Write a job's customer details, creating the row on first save and updating
 * it in place after.
 *
 * WHY THIS EXISTS AS A SHARED FUNCTION. This upsert lived inside `sendQuote`
 * and nowhere else, which meant the only way a contractor's typed customer
 * details ever reached the database was by sending the quote. Pressing "Save
 * changes" wrote `line_items_json` and nothing else — so a name, an email, a
 * phone number and a site address were accepted, reported "Saved", and were
 * gone on reload (reported 13 Sep).
 *
 * That is the same shape as the pricing-mode defect on the same screen: a
 * destructive outcome behind a control whose label says the opposite. It is
 * arguably worse here, because the contractor has no reason to suspect it —
 * nothing is visibly lost until they come back.
 *
 * Extracted rather than copied. A second implementation of an upsert is a
 * second thing to keep in step, and the idempotency guard below is the part
 * that must not drift: without it a re-send piles up duplicate customer rows
 * against one job.
 */

export type CustomerDetails = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  smsOptOut?: boolean;
};

/**
 * The `contact` JSON as stored. Phone is normalised to UK form where it can be,
 * falling back to what was typed so an unparseable number is kept rather than
 * dropped.
 */
export const buildCustomerContact = (customer: CustomerDetails) => {
  const normalizedPhone = customer.phone ? normalizeUkPhone(customer.phone) : null;
  return {
    email: customer.email,
    phone: normalizedPhone ?? customer.phone,
    address: customer.address,
    sms_opt_out: customer.smsOptOut,
  };
};

/**
 * Returns the customer row's id.
 *
 * `customerId` is the job's current `customer_id`, or null when it has none.
 * When null a row is inserted and the job is pointed at it — the same two-step
 * the send path has always performed.
 */
export const persistJobCustomer = async (
  supabase: SupabaseClient,
  {
    jobId,
    contractorId,
    customerId,
    customer,
  }: {
    jobId: string;
    contractorId: string;
    customerId: string | null;
    customer: CustomerDetails;
  },
): Promise<string> => {
  const contact = buildCustomerContact(customer);

  // Idempotency guard: a re-send or a double-tapped save must not pile up
  // duplicate customer rows. If this job already has a customer, update it in
  // place rather than inserting a fresh one each time.
  if (customerId) {
    const { error } = await supabase
      .from("customers")
      .update({ name: customer.name, contact })
      .eq("id", customerId);
    if (error) throw new Error(error.message);
    return customerId;
  }

  const { data: row, error } = await supabase
    .from("customers")
    .insert({ contractor_id: contractorId, name: customer.name, contact })
    .select("id")
    .single();

  if (error || !row) throw new Error(error?.message ?? "Failed to save customer");

  await supabase.from("jobs").update({ customer_id: row.id }).eq("id", jobId);

  return row.id as string;
};

/**
 * Whether there is anything worth writing.
 *
 * A save with every field blank must not create an empty customer row, and
 * must not blank an existing one — the contractor simply did not touch those
 * fields. Only a save carrying at least one non-empty detail persists.
 */
export const hasCustomerDetail = (customer: CustomerDetails | undefined): boolean =>
  Boolean(
    customer &&
      (customer.name?.trim() ||
        customer.email?.trim() ||
        customer.phone?.trim() ||
        customer.address?.trim()),
  );
