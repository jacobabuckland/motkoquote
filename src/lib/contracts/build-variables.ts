import type { LineItem } from "@/lib/schemas/job";
import type { BusinessProfile, ContractJobInput, ContractVariables } from "@/lib/schemas/contract";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import { formatGBP, formatDate } from "@/lib/format";
import { isIsoDate } from "@/lib/contracts/dates";

const gbp = (amount: number) => formatGBP(amount);

// The date pickers store `yyyy-mm-dd`; render it as "25 Aug 2026" (no day of
// week — formatDate never adds one, so the self-contradicting "Wednesday 25th
// August" can't recur). Legacy free-text values from older contracts pass
// through untouched.
const contractDateText = (value: string | null | undefined): string => {
  const v = (value ?? "").trim();
  if (!v) return "";
  return isIsoDate(v) ? formatDate(v) || v : v;
};

type ContractorInfo = {
  company_name: string;
  company_number: string | null;
  trade: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  business_profile: BusinessProfile;
  // Structured pay-by-bank account (Settings → Bank account). This is the
  // source of truth for the contract's payment details now that the free-text
  // profile.bank_details field has been retired.
  payout_account_holder_name: string | null;
  payout_sort_code: string | null;
  payout_account_number: string | null;
  payout_details_complete: boolean;
};

// Sort code is stored as 6 bare digits; show it grouped as XX-XX-XX.
const formatSortCode = (raw: string) => raw.replace(/(\d{2})(?=\d)/g, "$1-");

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
  // Blank when neither the job nor the profile supplies a warranty period, so
  // the guarantee clause is omitted entirely rather than printing a legal
  // sentence with "Not specified" in it (see templates' {{#warranty_period}}).
  const warrantyPeriod = jobInput.warranty_period || profile.default_warranty_period || "";

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

  // Prefer the structured payout account; fall back to any legacy free-text
  // bank_details a trade set before the field was retired.
  const payoutBankDetails =
    contractor.payout_details_complete &&
    contractor.payout_account_holder_name &&
    contractor.payout_sort_code &&
    contractor.payout_account_number
      ? `${contractor.payout_account_holder_name}, sort code ${formatSortCode(
          contractor.payout_sort_code,
        )}, account no. ${contractor.payout_account_number}`
      : "";
  const bankDetails = payoutBankDetails || (profile.bank_details ?? "");

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
    bank_details: bankDetails,
    governing_law: profile.governing_law || "England & Wales",

    client_name: customer?.name ?? "",
    client_address: jobInput.client_address ?? "",
    client_contact: clientContact,
    site_address: siteAddress,
    contract_date: contractDate,
    quote_reference: quoteReference,
    scope_of_work:
      jobInput.scope_of_work || "See the accompanying quote for full details",
    exclusions: jobInput.exclusions ?? "",
    materials_by: jobInput.materials_by || "",
    materials_notes: jobInput.materials_notes ?? "",
    labour_cost: gbp(labourCost),
    materials_cost: gbp(materialsCost),
    subtotal: gbp(subtotal),
    vat_amount: gbp(vat),
    total_price: gbp(total),
    deposit_amount: depositAmount !== null ? gbp(depositAmount) : "",
    payment_schedule: jobInput.payment_schedule ?? "",
    // Timing fields are bold-wrapped (**{{start_date}}**) in the templates, so
    // an empty value would render as a literal "****". Fall back to "To be
    // confirmed" — a real answer on a contract — rather than "Not specified"
    // or an empty string.
    start_date: contractDateText(jobInput.start_date) || "To be confirmed",
    estimated_duration: jobInput.estimated_duration || "To be confirmed",
    completion_date: contractDateText(jobInput.completion_date) || "To be confirmed",
    access_arrangements: jobInput.access_arrangements ?? "",
    warranty_period: warrantyPeriod,
    building_regs_responsibility: jobInput.building_regs_responsibility || "",
    cancellation_start: jobInput.cancellation_start ?? "No",
    special_terms: jobInput.special_terms ?? "",
  };
};
