import type { LineItem } from "@/lib/schemas/job";
import type { BusinessProfile, ContractJobInput, ContractVariables } from "@/lib/schemas/contract";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";

const gbp = (amount: number) => `£${amount.toFixed(2)}`;

type ContractorInfo = {
  company_name: string;
  company_number: string | null;
  trade: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  business_profile: BusinessProfile;
};

type CustomerInfo = {
  name: string;
  contact: { email?: string };
} | null;

type BuildContractVariablesInput = {
  contractor: ContractorInfo;
  customer: CustomerInfo;
  lineItems: LineItem[];
  quoteReference: string;
  depositAmount: number | null;
  jobInput: ContractJobInput;
};

// Assembles the full {{variable}} -> value map for a contract from the
// contractor's business profile (set once, reused every contract) and the
// per-job fields the contractor supplies when sending this specific contract.
export const buildContractVariables = ({
  contractor,
  customer,
  lineItems,
  quoteReference,
  depositAmount,
  jobInput,
}: BuildContractVariablesInput): ContractVariables => {
  const profile = contractor.business_profile;
  const { subtotal, vat, total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  const labourCost =
    Math.round(
      lineItems
        .filter((item) => item.category === "labour")
        .reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;
  const materialsCost = Math.round((subtotal - labourCost) * 100) / 100;

  const contractDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const siteAddress = jobInput.site_address || jobInput.client_address || "";
  const warrantyPeriod =
    jobInput.warranty_period || profile.default_warranty_period || "Not specified";

  // Combined "Contact: X / Y" lines. Built here (rather than left as bare
  // {{business_phone}} / {{business_email}} in the template) so that when
  // one or both are missing, the whole line disappears cleanly instead of
  // leaving "Contact: / ." in the rendered contract.
  const businessContact = [profile.business_phone, profile.business_email]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const clientContact = [jobInput.client_phone, customer?.contact?.email]
    .filter((value): value is string => Boolean(value))
    .join(" / ");

  // Only claim insurance cover in the contract when both the insurer and
  // the cover amount are actually on file — a half-filled insurance clause
  // ("insurance with  up to .") is worse than no clause at all.
  const insuranceDisclosed = profile.insurer_name && profile.public_liability_cover ? "yes" : "";

  return {
    business_name: contractor.company_name,
    trading_name: profile.trading_name ?? "",
    business_structure: profile.business_structure ?? "",
    company_number: contractor.company_number ?? "",
    registered_address: profile.registered_address ?? "",
    trade: contractor.trade ?? "",
    business_contact: businessContact,
    business_email: profile.business_email ?? "",
    vat_registered: contractor.vat_registered ? "yes" : "",
    vat_number: contractor.vat_number ?? "",
    certifications: profile.certifications ?? "",
    insurance_disclosed: insuranceDisclosed,
    insurer_name: profile.insurer_name ?? "",
    public_liability_cover: profile.public_liability_cover ?? "",
    default_payment_terms: profile.default_payment_terms ?? "",
    payment_methods: profile.payment_methods ?? "",
    bank_details: profile.bank_details ?? "",
    governing_law: profile.governing_law || "England & Wales",

    client_name: customer?.name ?? "",
    client_address: jobInput.client_address ?? "",
    client_contact: clientContact,
    site_address: siteAddress,
    contract_date: contractDate,
    quote_reference: quoteReference,
    scope_of_work:
      jobInput.scope_of_work || "Not specified — see the accompanying quote for full details",
    exclusions: jobInput.exclusions ?? "",
    materials_by: jobInput.materials_by || "Not specified",
    materials_notes: jobInput.materials_notes ?? "",
    labour_cost: gbp(labourCost),
    materials_cost: gbp(materialsCost),
    subtotal: gbp(subtotal),
    vat_amount: gbp(vat),
    total_price: gbp(total),
    deposit_amount: depositAmount !== null ? gbp(depositAmount) : "",
    payment_schedule: jobInput.payment_schedule ?? "",
    // These are bold-wrapped (**{{start_date}}**) in the templates, so an
    // empty value would render as a literal "****" — always fall back to
    // "Not specified" rather than passing through an empty string.
    start_date: jobInput.start_date || "Not specified",
    estimated_duration: jobInput.estimated_duration || "Not specified",
    completion_date: jobInput.completion_date || "Not specified",
    access_arrangements: jobInput.access_arrangements ?? "",
    warranty_period: warrantyPeriod,
    building_regs_responsibility: jobInput.building_regs_responsibility || "Not specified",
    cancellation_start: jobInput.cancellation_start ?? "No",
    special_terms: jobInput.special_terms ?? "",
  };
};
