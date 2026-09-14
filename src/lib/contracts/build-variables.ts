import type { LineItem } from "@/lib/schemas/job";
import type { BusinessProfile, ContractJobInput, ContractVariables } from "@/lib/schemas/contract";
import { quoteTotalsForDisplay } from "@/lib/vat-record";
import { lineItemTotal } from "@/lib/quote-math";
import { formatGBP, formatDate } from "@/lib/format";
import { isIsoDate } from "@/lib/contracts/dates";
import { canAcceptStripePayment } from "@/lib/stripe-connect";

const gbp = (amount: number) => formatGBP(amount);

/**
 * The three variables that decide the shape of the clause 2 price table.
 *
 * ONE RULE, TWO CALLERS, AND THAT IS THE POINT. `buildContractVariables` below
 * derives them for a new contract; `planContractRepair` derives them for a
 * stored one. When only the first did, the second inherited them as ABSENT —
 * and the renderer reads absent as false, so a repair meant to fix the labour
 * split deleted the Labour, Materials and VAT rows outright:
 *
 *     | Subtotal | £740.00 |
 *     | **Total** | **£888.00** |
 *
 * £148 of VAT and the VAT number gone from a priced document, on the script
 * whose whole purpose is correcting contracts already sent.
 *
 * Compared as FORMATTED strings so the repair path — which holds only the
 * stored strings — asks exactly the same question this does.
 */
export const priceTableControls = (input: {
  materialsCost: string;
  vatAmount: string;
  vatRegistered: boolean;
  vatNumber: string | null;
}): { has_materials: string; charged_vat: string; vat_row_label: string } => {
  const zero = formatGBP(0);
  return {
    has_materials: input.materialsCost !== zero ? "yes" : "",
    charged_vat: input.vatAmount !== zero ? "yes" : "",
    // THE LABEL IS RESOLVED HERE, NOT IN THE TEMPLATE.
    //
    // `render-template.ts` is a single non-recursive pass: an outer section
    // consumes its inner text wholesale and `String.replace` never rescans what
    // it substitutes. So `{{#vat_registered}}` nested inside the
    // `{{#charged_vat}}` row was never rendered — it was PRINTED:
    //
    //     | VAT{{#vat_registered}} (VAT no. GB123456789){{/vat_registered}} | £148.00 |
    //
    // on every contract by a registered trade that charged VAT. It reached main
    // in #757 because that row only renders when `charged_vat` is set, the
    // golden fixture never set it, and the gate therefore re-baselined a table
    // with no VAT row and never saw the branch.
    vat_row_label:
      input.vatRegistered && input.vatNumber ? `VAT (VAT no. ${input.vatNumber})` : "VAT",
  };
};

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
  // Whether the contractor can take a Stripe payment. When they can, the
  // contract must NOT print bank details — see the bankDetails block below.
  stripe_account_id: string | null;
  stripe_payouts_enabled: boolean;
  stripe_pay_by_bank_enabled: boolean;
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
  // WHAT THE QUOTE RECORDED. Absent on a caller that has no quote row, and
  // null-valued on a quote written before migration 80 — both fall back to
  // computing, which is all this ever did. Where it IS present it wins.
  recordedQuote?: {
    total: number;
    subtotal: number | null;
    vat_amount: number | null;
  } | null;
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
  recordedQuote,
}: BuildContractVariablesInput): ContractVariables => {
  const profile = contractor.business_profile;

  // THE CONTRACT SAYS WHAT THE QUOTE SAID. It is the document with a signature
  // on it, and it may not disagree with the figure the customer accepted.
  //
  // This computed from the contractor's CURRENT `vat_registered` flag, so a
  // quote written while unregistered — recorded VAT £0.00, £740.00 on /q/[id]
  // and on the PDF — produced a contract whose clause 2 read
  // "Subtotal £740.00 · VAT £148.00 · Total £888.00" once registration was
  // switched back on. One page, two prices, and the payment schedule in the
  // header (222 + 518 = 740) no longer summed to the price clause. Reported
  // 14 Sep, and it is the same defect already fixed on the quote PDF, the job
  // page and /q/[id] — this was the fourth surface and the only one a customer
  // signs.
  //
  // Frozen at generation either way: the stored contract keeps whatever it was
  // rendered with. That behaviour was already right and is unchanged; what
  // changes is that the figure rendered is now the recorded one.
  const { subtotal, vat, total } = quoteTotalsForDisplay(
    recordedQuote ?? { total: 0, subtotal: null, vat_amount: null },
    lineItems,
    contractor.vat_registered,
  );

  // MATERIALS is the derived-from side, and labour takes the remainder.
  //
  // It used to be the other way round — labour summed `category === "labour"`
  // and materials was whatever was left — which put every line that is neither
  // into the Materials row: `travel`, `callout`, and, fatally, `other`.
  //
  // `other` is what a FIXED-PRICE quote collapses to. applyPricingMode builds
  // the single works line with `category: "other"` (pricing-mode.ts), so every
  // fixed-price contract — the commonest kind — printed
  //
  //     | Labour    | £0.00   |
  //     | Materials | £450.00 |
  //
  // for a job that was entirely labour. A customer reads that as "he's charging
  // me nothing to do the work and £450 for bags of plaster": it invites a price
  // challenge, it is false, and it misdescribes the supply.
  //
  // Only `materials` is genuinely materials. Everything else the contractor is
  // charging for — their time, their travel, their call-out, an undifferentiated
  // works line — belongs on the labour side of a two-row table. Reported 13 Sep
  // against a live £450 contract.
  const materialsCost =
    Math.round(
      lineItems
        .filter((item) => item.category === "materials")
        .reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;
  const labourCost = Math.round((subtotal - materialsCost) * 100) / 100;

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

  // The Materials clause's opening sentence, built here for the same reason
  // business_contact is: the template had
  // `{{#materials_by}}…{{/materials_by}}{{materials_notes}}` as its whole first
  // paragraph, so a contract with neither field collapsed that paragraph to
  // nothing and the clause opened mid-thought on its SECOND — "Materials
  // supplied by the Contractor remain the Contractor's property…". Reported
  // 13 Sep: present on one live contract, absent on another, same template.
  //
  // The fallback says where the answer lives rather than naming a party.
  // Asserting "the Contractor" when nobody said so would invent an obligation
  // on a document the customer signs. Wording approved by Jacob, 13 Sep.
  const materialsStatement = jobInput.materials_by
    ? `Materials will be supplied by: **${jobInput.materials_by}**.`
    : "Responsibility for supplying materials is as set out in the scope of work in clause 1.";

  // Only claim insurance cover in the contract when both the insurer and
  // the cover amount are actually on file — a half-filled insurance clause
  // ("insurance with  up to .") is worse than no clause at all.
  const insuranceDisclosed = profile.insurer_name && profile.public_liability_cover ? "yes" : "";

  // The contract is the second surface that leaked a fee-free payment route.
  // Under PAY-4 fee-at-source motko earns only when money moves through the
  // Stripe rail, and every template renders {{bank_details}} — on a document
  // the customer keeps, before the invoice even exists. So the details are
  // printed ONLY when the contractor cannot take a Stripe charge.
  //
  // Gated on capability, not on account existence: a contractor mid-
  // verification has a Connect account and cannot be paid through it, and
  // must still be payable. canAcceptStripePayment is the same gate the
  // customer invoice page uses, so the two surfaces cannot disagree.
  //
  // When the rail is live this resolves to "", and every {{#bank_details}}
  // section collapses to nothing — no template body changes needed.
  const railAvailable = canAcceptStripePayment(contractor);

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
  const bankDetails = railAvailable
    ? ""
    : payoutBankDetails || (profile.bank_details ?? "");

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
    materials_statement: materialsStatement,
    materials_notes: jobInput.materials_notes ?? "",
    labour_cost: gbp(labourCost),
    materials_cost: gbp(materialsCost),
    // STOP ASSERTING A SPLIT THE DATA DOES NOT SUPPORT.
    //
    // The Labour/Materials rows have exactly two buckets and `other` falls into
    // labour (see the note above, which is still the right assignment). The
    // editor's Kind field defaults to "Other", so a hand-typed quote lands 100%
    // labour: three lines left as Other — "Reskim hallway ceiling £500",
    // "Bonding and multi-finish £180", "Waste removal £60" — printed
    // "Labour £740.00 · Materials £0.00" on a job containing £180 of bonding.
    // That is more misleading than one unlabelled row, because it names the
    // wrong thing confidently.
    //
    // And on a job that genuinely has no materials it is noise either way: an
    // all-labour contract printing "Materials £0.00" says nothing.
    //
    // So the split renders only where SOMETHING was categorised as materials —
    // where a human made the distinction, the distinction is evidenced. Where
    // nobody did, clause 2 shows Subtotal and Total and asserts nothing about
    // the composition. Same rule as the recorded-VAT columns: an unknown split
    // is not a zero one.
    //
    // Retroactive by construction: it fixes every contract rendered from here,
    // including from quotes already in the database. Making Kind a required
    // choice before send is the other half and only helps rows written after
    // it, which is why this is first.
    ...priceTableControls({
      materialsCost: gbp(materialsCost),
      vatAmount: gbp(vat),
      vatRegistered: contractor.vat_registered,
      vatNumber: contractor.vat_number,
    }),
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
