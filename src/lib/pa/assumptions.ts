// The three assumptions a draft rests on, and whether the contractor has
// confirmed each: pricing mode, crew size, and who supplies the materials.
//
// This replaces the old voice rule of asking all three out loud. The new rule
// keeps its intent — they are never silently guessed — by making them visible
// on the quote card and refusing to send until each is confirmed.
//
// WHAT "CONFIRMED" MEANS
//   * A slot that has never been stated (null in the SoW) is "not set": the card
//     says so and nothing is defaulted. It cannot be confirmed until a value
//     exists. (The agent asks, or the contractor tells it.)
//   * A chat-made draft has a pa_draft_assumptions row; a slot is confirmed when
//     its *_confirmed_at is set AND it has a value. Changing the value clears it.
//   * A job with NO row was not made in chat (it came from the voice intake,
//     where the contractor answered the slots aloud). Its slots count as
//     confirmed when they hold a value the call did not flag as unasked.
//   * Only a user tap confirms. The model's set_assumption records a value; it
//     never sets a confirmed_at.

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatGBP } from "@/lib/format";
import type { SowState } from "@/lib/schemas/sow";
import { sanitiseForModel } from "./data";
import type { AssumptionSlot, AssumptionView } from "./types";

export const ASSUMPTION_SLOTS: AssumptionSlot[] = ["pricing_mode", "crew", "materials_supply"];

const LABELS: Record<AssumptionSlot, string> = {
  pricing_mode: "Pricing",
  crew: "Crew",
  materials_supply: "Materials",
};

// The checklist ids the voice intake uses for the same three questions, so a
// voice-captured job that ended without asking one is not read as confirmed.
const CHECKLIST_ID: Record<AssumptionSlot, string> = {
  pricing_mode: "duration",
  crew: "crew",
  materials_supply: "materials_supply",
};

const COLUMN: Record<AssumptionSlot, string> = {
  pricing_mode: "pricing_confirmed_at",
  crew: "crew_confirmed_at",
  materials_supply: "materials_confirmed_at",
};

export type AssumptionRecord = {
  job_id: string;
  contractor_id: string;
  pricing_confirmed_at: string | null;
  crew_confirmed_at: string | null;
  materials_confirmed_at: string | null;
};

const pricingValue = (sow: SowState | null): string | null => {
  const mode = sow?.pricing?.mode;
  if (!mode) return null;
  if (mode === "fixed") {
    const amount = sow?.pricing?.fixed_amount;
    // A fixed price with no figure is not something to confirm.
    return amount ? `Fixed price, ${formatGBP(amount)} before VAT` : null;
  }
  if (mode === "days") return "Day rate";
  return "Worked out from your rates";
};

const crewValue = (sow: SowState | null): string | null => {
  const plan = sow?.labour_plan;
  if (!plan) return null;
  const count =
    plan.people_count ?? (plan.crew_days?.length ? plan.crew_days.length : null);
  if (count != null) return count === 1 ? "Just you" : `${count} people`;
  return sanitiseForModel(plan.crew_description, 120) || null;
};

const materialsValue = (sow: SowState | null): string | null => {
  const supply = sow?.materials_supply;
  if (!supply) return null;
  const responsibility =
    supply.responsibility ??
    (supply.contractor_supplied.length && supply.customer_supplied.length
      ? "split"
      : supply.contractor_supplied.length
        ? "contractor"
        : supply.customer_supplied.length
          ? "customer"
          : undefined);
  if (responsibility === "contractor") return "You supply the materials";
  if (responsibility === "customer") return "Customer supplies the materials";
  if (responsibility === "split") return "Materials split between you and the customer";
  return null;
};

const valueOf = (slot: AssumptionSlot, sow: SowState | null): string | null =>
  slot === "pricing_mode" ? pricingValue(sow) : slot === "crew" ? crewValue(sow) : materialsValue(sow);

export const deriveAssumptions = (
  sow: SowState | null,
  record: AssumptionRecord | null,
): AssumptionView[] =>
  ASSUMPTION_SLOTS.map((slot) => {
    const value = valueOf(slot, sow);
    let confirmed: boolean;
    if (value === null) {
      confirmed = false;
    } else if (record) {
      confirmed = Boolean(record[COLUMN[slot] as keyof AssumptionRecord]);
    } else {
      confirmed = !(sow?.unasked_required ?? []).includes(CHECKLIST_ID[slot] as never);
    }
    return { slot, label: LABELS[slot], value, confirmed };
  });

export const unconfirmedSlots = (assumptions: AssumptionView[]): AssumptionView[] =>
  assumptions.filter((assumption) => !assumption.confirmed);

export const loadAssumptionRecord = async (
  db: SupabaseClient,
  contractorId: string,
  jobId: string,
): Promise<AssumptionRecord | null> => {
  const { data } = await db
    .from("pa_draft_assumptions")
    .select("job_id, contractor_id, pricing_confirmed_at, crew_confirmed_at, materials_confirmed_at")
    .eq("job_id", jobId)
    .eq("contractor_id", contractorId)
    .maybeSingle();
  return (data as unknown as AssumptionRecord | null) ?? null;
};

// Creates the row for a job. Slots that are already confirmed under the
// no-record rule (voice-captured answers) are seeded as confirmed, so adopting
// a voice job into chat does not un-confirm what the contractor said aloud.
export const ensureAssumptionRecord = async (
  db: SupabaseClient,
  contractorId: string,
  jobId: string,
  sow: SowState | null,
  now: Date,
  seedFromSow: boolean,
): Promise<AssumptionRecord> => {
  const existing = await loadAssumptionRecord(db, contractorId, jobId);
  if (existing) return existing;

  const seeded = seedFromSow ? deriveAssumptions(sow, null) : [];
  const stamp = now.toISOString();
  const row: AssumptionRecord & { updated_at: string } = {
    job_id: jobId,
    contractor_id: contractorId,
    pricing_confirmed_at:
      seeded.find((a) => a.slot === "pricing_mode")?.confirmed ? stamp : null,
    crew_confirmed_at: seeded.find((a) => a.slot === "crew")?.confirmed ? stamp : null,
    materials_confirmed_at:
      seeded.find((a) => a.slot === "materials_supply")?.confirmed ? stamp : null,
    updated_at: stamp,
  };
  const { error } = await db.from("pa_draft_assumptions").insert(row);
  if (error) throw new Error("Couldn't record the draft's assumptions.");
  return row;
};

// Sets or clears one slot's confirmation. Always filtered by job AND
// contractor.
export const setSlotConfirmation = async (
  db: SupabaseClient,
  contractorId: string,
  jobId: string,
  slot: AssumptionSlot,
  confirmedAt: Date | null,
  now: Date,
): Promise<void> => {
  const { error } = await db
    .from("pa_draft_assumptions")
    .update({ [COLUMN[slot]]: confirmedAt ? confirmedAt.toISOString() : null, updated_at: now.toISOString() })
    .eq("job_id", jobId)
    .eq("contractor_id", contractorId);
  if (error) throw new Error("Couldn't update the assumption.");
};
