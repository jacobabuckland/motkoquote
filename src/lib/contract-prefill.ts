// What the contract form starts with, derived from the job the contract is for.
//
// The form used to be handed only the scope and access notes, so "Client
// address" and "Client phone" opened empty on every contract — even though both
// were captured during intake and both were already printed on the statement of
// work the customer had been sent. Making a tradesperson retype what he
// dictated ten minutes earlier is the specific indignity this product exists to
// remove.
//
// Pure, so what the form receives is bound by a test rather than by reading a
// prop spread in a server component that cannot easily be rendered.

import { materialsResponsibility } from "@/lib/materials-summary";
import type { MaterialsSupply } from "@/lib/schemas/job";

export type ContractPrefillJob = {
  customer: { contact: { phone?: string; address?: string } | null } | null;
  extracted_json: {
    scope_items?: string[];
    access_issues?: string;
    materials_supply?: MaterialsSupply | null;
  } | null;
} | null;

export type ContractPrefill = {
  scope_of_work: string;
  access_arrangements: string;
  client_address: string;
  client_phone: string;
  materials_by: string;
  materials_notes: string;
};

export const contractPrefillFromJob = (job: ContractPrefillJob): ContractPrefill => ({
  scope_of_work: (job?.extracted_json?.scope_items ?? []).join("; "),
  access_arrangements: job?.extracted_json?.access_issues ?? "",
  // Empty string rather than undefined: the form's fields are controlled, and
  // an absent value must leave a usable empty input, never placeholder text
  // presented as captured data.
  client_address: job?.customer?.contact?.address ?? "",
  client_phone: job?.customer?.contact?.phone ?? "",
  // Derived from the SAME captured field the quote and statement of work
  // render from, so the three documents cannot contradict each other. The
  // field stays editable; it just no longer starts empty next to a SoW that
  // already states the answer.
  materials_by: materialsResponsibility(job?.extracted_json?.materials_supply).by,
  materials_notes: materialsResponsibility(job?.extracted_json?.materials_supply).notes,
});
