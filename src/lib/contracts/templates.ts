import type { ContractTemplateKey } from "@/lib/schemas/contract";

// Verbatim legal template bodies, provided as drafting starting points.
// Do not edit the wording — only the {{variable}} plumbing around them.
// Jurisdiction: England & Wales. Draft templates — a solicitor should review
// before use, particularly the consumer cancellation clauses.

const SMALL_WORKS = `# Contract for Small Works

**Use for:** single-visit or low-value jobs, paid on completion (e.g. a repair, a tap replacement, a small decorating job).
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}, {{business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}, of {{registered_address}}. Contact: {{business_phone}} / {{business_email}}.

**The Client:** {{client_name}} of {{client_address}}. Contact: {{client_phone}} / {{client_email}}.

Quote reference: **{{quote_reference}}**

## 1. The Work

The Contractor agrees to carry out the following work at {{site_address}}:

> {{scope_of_work}}

**Not included:** {{exclusions}}

## 2. Price and Payment

The total price for the work is **{{total_price}}**{{#vat_registered}}, which includes VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}.

Payment is due **on completion** of the work, unless otherwise agreed. {{default_payment_terms}}. Accepted payment methods: {{payment_methods}}. {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}}

If the work required turns out to be materially different from what was described (for example, hidden damage is found), the Contractor will stop and agree any change in price with the Client before continuing.

## 3. Materials

Materials will be supplied by: **{{materials_by}}**. {{materials_notes}}

## 4. Timing

The work is expected to be carried out on or around **{{start_date}}** and to take approximately **{{estimated_duration}}**. Timings are estimates given in good faith and may be affected by matters outside the Contractor's control.

## 5. Access

The Client will provide safe and reasonable access to the site. {{access_arrangements}}

## 6. Workmanship and Guarantee

The Contractor will carry out the work with reasonable care and skill, using materials of satisfactory quality, in line with the Client's rights under the Consumer Rights Act 2015. The Contractor guarantees its workmanship for **{{warranty_period}}** from completion. This guarantee does not cover fair wear and tear, misuse, or work later altered by others. Manufacturer warranties on materials apply in addition.

## 7. Your Right to Cancel (Consumer Cancellation Rights)

Because this contract is agreed away from the Contractor's business premises (for example, in your home or online), you have the right to cancel within **14 days** of entering into it, without giving a reason, under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, tell the Contractor in a clear statement (e.g. by email to {{business_email}}) before the 14 days end. You may use the model cancellation form in Schedule A.
- **If you want the work to begin within the 14-day period**, you must expressly request this. By requesting an early start you agree that if you then cancel, you must pay for work already carried out up to the point of cancellation.
- Requested early start: **{{cancellation_start}}**.

## 8. Liability

The Contractor holds public liability insurance with {{insurer_name}} for up to {{public_liability_cover}}. Nothing in this contract limits liability for death or personal injury caused by negligence, or for anything that cannot be limited by law.

## 9. Complaints and Disputes

If something isn't right, please tell the Contractor first so it can be put right. This contract is governed by the law of **{{governing_law}}** and subject to the courts of England & Wales.

{{#special_terms}}## 10. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return this form only if you wish to cancel the contract.)*

To {{business_name}}, {{registered_address}}, {{business_email}}:

I/We hereby give notice that I/We cancel my/our contract for the following work: {{scope_of_work}}.

Ordered on: {{contract_date}}
Name: {{client_name}}
Address: {{client_address}}
Signature (if on paper): ____________  Date: __________
`;

const STANDARD_PROJECT = `# Contract for a Standard Project

**Use for:** multi-day jobs involving labour and materials, paid with a deposit and a balance on completion (e.g. a bathroom refresh, a room rewire, a fence installation).
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}, {{business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}, of {{registered_address}}. Trade: {{trade}}. Contact: {{business_phone}} / {{business_email}}.

**The Client:** {{client_name}} of {{client_address}}. Contact: {{client_phone}} / {{client_email}}.

Quote reference: **{{quote_reference}}** | Site: {{site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

**Excluded from this contract:** {{exclusions}}

## 2. Price

| Item | Amount |
|---|---|
| Labour | {{labour_cost}} |
| Materials | {{materials_cost}} |
| Subtotal | {{subtotal}} |
| VAT{{#vat_registered}} (VAT no. {{vat_number}}){{/vat_registered}} | {{vat_amount}} |
| **Total** | **{{total_price}}** |

The price is based on the scope in clause 1. It is fixed unless varied under clause 5.

## 3. Payment

- **Deposit:** {{deposit_amount}}, payable to confirm the booking and secure materials.
- **Balance:** the remainder is due on completion. {{default_payment_terms}}.
- Accepted payment methods: {{payment_methods}}. {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}}

Late payment may attract interest and reasonable recovery costs under the Late Payment of Commercial Debts (Interest) Act 1998 where that Act applies.

## 4. Materials

Materials will be supplied by: **{{materials_by}}**. {{materials_notes}}

Materials supplied by the Contractor remain the Contractor's property until paid for in full. Where the Client supplies materials, the Contractor is not responsible for their quality or suitability.

## 5. Variations (Extras and Changes)

Any change to the scope of work must be agreed **in writing** (including by message or via Motko) before that work is carried out, together with any change to the price and timescale. Unforeseen conditions (e.g. hidden damage, non-compliant existing installations) will be treated as a variation.

## 6. Timing

- Estimated start: **{{start_date}}**
- Estimated duration: **{{estimated_duration}}**
- Estimated completion: **{{completion_date}}**

These are good-faith estimates. The Contractor will not be liable for delays caused by matters outside its reasonable control (including the Client, the Client's other contractors, supply issues, or weather), but will keep the Client informed.

## 7. Access, Site and Welfare

The Client will provide safe access, and reasonable use of water, power and welfare facilities where needed. {{access_arrangements}} The Contractor will keep the working area reasonably tidy and remove its own waste unless agreed otherwise.

## 8. Workmanship, Standards and Guarantee

The Contractor will perform the work with reasonable care and skill and in accordance with relevant standards and, where applicable, the Building Regulations. In line with the Consumer Rights Act 2015, the work will be carried out to a satisfactory standard and materials will be of satisfactory quality.

The Contractor guarantees its workmanship for **{{warranty_period}}** from completion. The guarantee excludes fair wear and tear, misuse, neglect, and work subsequently altered by others. Manufacturer warranties apply in addition.

## 9. Completion and Sign-Off

The work is complete when it has been carried out in accordance with clause 1 (subject to any agreed variations). The Client will be invited to inspect and sign off on completion. Minor snagging items will be listed and put right within a reasonable time and do not delay payment of the balance.

## 10. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it, without giving a reason, under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor in a clear statement (e.g. email {{business_email}}) within the 14 days. You may use the form in Schedule A.
- **Early start:** if you want work to begin within the 14-day period you must request this expressly (**{{cancellation_start}}**). If you then cancel, you must pay for work done and materials reasonably ordered up to cancellation.

## 11. Insurance and Liability

The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. Nothing limits liability for death or personal injury from negligence, fraud, or anything that cannot be excluded by law. Otherwise, the Contractor is not liable for indirect or consequential loss.

## 12. Governing Law and Disputes

If there is a problem, please raise it with the Contractor first. This contract is governed by the law of **{{governing_law}}** and subject to the courts of England & Wales.

{{#special_terms}}## 13. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}, {{registered_address}}, {{business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const LARGE_STAGED_PROJECT = `# Contract for a Large / Staged Project

**Use for:** higher-value jobs paid in stages, with a deposit, milestone payments and (optionally) retention (e.g. extensions, full rewires, roof replacements, kitchen fits).
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use, especially the payment-schedule and retention clauses.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}, {{business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}, of {{registered_address}}. Trade: {{trade}}. Certifications: {{certifications}}. Contact: {{business_phone}} / {{business_email}}.

**The Client:** {{client_name}} of {{client_address}}. Contact: {{client_phone}} / {{client_email}}.

Quote reference: **{{quote_reference}}** | Site: {{site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

**Excluded:** {{exclusions}}

The scope, drawings, specifications and any quotation attached form part of this contract. Where documents conflict, this signed contract takes precedence.

## 2. Contract Price

| Item | Amount |
|---|---|
| Labour | {{labour_cost}} |
| Materials | {{materials_cost}} |
| Subtotal | {{subtotal}} |
| VAT{{#vat_registered}} (VAT no. {{vat_number}}){{/vat_registered}} | {{vat_amount}} |
| **Total contract price** | **{{total_price}}** |

## 3. Payment Schedule (Stage Payments)

- **Deposit:** {{deposit_amount}}, payable on signing to confirm the booking and order materials.
- **Stage payments:** the balance is payable against completed milestones as set out below. Each stage becomes due when that stage is complete and the Contractor has issued an invoice.

> {{payment_schedule}}

Each stage invoice is payable within the terms in {{default_payment_terms}}. Accepted payment methods: {{payment_methods}}. {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}} The Contractor may pause work on any stage that is not paid when due, having given the Client reasonable written notice.

## 4. Retention (optional)

Where a retention is agreed, the Client may hold back a small agreed percentage of each stage payment (stated in the payment schedule), released once any snagging listed at completion is signed off, and no later than a reasonable period after completion.

## 5. Materials and Title

Materials supplied by: **{{materials_by}}**. {{materials_notes}} Materials supplied by the Contractor remain its property until paid for. Risk in installed works passes to the Client on installation.

## 6. Variations

No variation to the scope, price or programme is binding unless agreed **in writing** (including via Motko) before the varied work is done. The Contractor will provide the cost and any programme impact of a variation before proceeding. Unforeseen ground, structural or existing-installation conditions are variations.

## 7. Programme and Delays

- Start: **{{start_date}}** | Estimated duration: **{{estimated_duration}}** | Estimated completion: **{{completion_date}}**

Dates are estimates given in good faith. The completion date will be reasonably extended for variations, delays caused by the Client or the Client's other contractors, late decisions or payments, supply-chain delays, adverse weather, or other matters outside the Contractor's reasonable control.

## 8. Access, Site and Welfare

The Client will give the Contractor clear and safe access to the site for the duration of the works, and reasonable use of power, water and welfare facilities. {{access_arrangements}} The Client is responsible for obtaining any planning permission, party-wall agreements or third-party consents unless agreed otherwise in writing.

## 9. Standards, Building Regulations and Guarantee

The Contractor will carry out the work with reasonable care and skill, in accordance with relevant British Standards and the Building Regulations. Responsibility for building-regulations notification and certification: **{{building_regs_responsibility}}**.

The Contractor guarantees its workmanship for **{{warranty_period}}** from completion, excluding fair wear and tear, misuse, and work later altered by others. Manufacturer and structural warranties apply in addition. The Client's statutory rights under the Consumer Rights Act 2015 are unaffected.

## 10. Completion and Snagging

On practical completion the Contractor and Client will inspect the works together and agree a snagging list of any minor items. The Contractor will complete snagging within a reasonable period. Practical completion is not delayed by minor snagging.

## 11. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want work or material orders to begin within the 14-day period you must request this expressly (**{{cancellation_start}}**). If you then cancel, you must pay for work done and materials reasonably committed up to cancellation.

## 12. Suspension and Termination

Either party may end this contract for a serious, unremedied breach by the other after giving reasonable written notice. On termination the Client will pay for all work properly carried out and materials reasonably ordered up to that date.

## 13. Insurance and Liability

The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law. Subject to that, the Contractor's total liability is limited to the contract price, and the Contractor is not liable for indirect or consequential loss.

## 14. Governing Law and Disputes

The parties will try to resolve any dispute amicably first, and may agree to mediation. This contract is governed by the law of **{{governing_law}}** and subject to the courts of England & Wales.

{{#special_terms}}## 15. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}, {{registered_address}}, {{business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const REGULATED_CERTIFIED_WORKS = `# Contract for Regulated / Certified Works

**Use for:** work that requires certification or is notifiable under the Building Regulations — gas work (Gas Safe), electrical work (Part P), and similar. Can be used standalone or its compliance clauses (2, 3, 4) bolted onto the Standard or Large-Project templates.
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use. Do not use this to imply a registration the tradesperson does not actually hold.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}, {{business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}, of {{registered_address}}. Trade: {{trade}}. Contact: {{business_phone}} / {{business_email}}.

**Registrations & accreditations:** {{certifications}}

**The Client:** {{client_name}} of {{client_address}}. Contact: {{client_phone}} / {{client_email}}.

Quote reference: **{{quote_reference}}** | Site: {{site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

**Excluded:** {{exclusions}}

## 2. Competence and Registration

The Contractor confirms it holds, and will maintain for the duration of the work, the registrations listed above ({{certifications}}) that are required to carry out this work lawfully. Only appropriately registered and competent operatives will carry out the notifiable elements. The Contractor will provide its registration details on request.

## 3. Building Regulations, Notification and Certification

This work includes elements that are notifiable and/or require certification. Responsibility for notification and certification is: **{{building_regs_responsibility}}**.

Where the Contractor is responsible, it will (as applicable):

- carry out the work to the relevant standards (e.g. BS 7671 for electrical installations; Gas Safety (Installation and Use) Regulations 1998 for gas work);
- notify the work under the relevant competent-person scheme or to Building Control; and
- provide the Client with the appropriate certificate(s) — for example an Electrical Installation Certificate / EICR, Gas Safety Record, or Building Regulations Compliance Certificate — on completion and payment.

Certificates will be issued once the work is complete and paid for in accordance with clause 5.

## 4. Inspection, Testing and Handover

The Contractor will inspect and test the work as required by the applicable standards before handover, and will explain to the Client any actions the Client must take (for example, servicing intervals or safe-use guidance). Where pre-existing installations are found to be unsafe or non-compliant, the Contractor will inform the Client; remedying them is a variation under clause 6.

## 5. Price and Payment

The total price for the work is **{{total_price}}**{{#vat_registered}}, including VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}.

{{#deposit_amount}}A deposit of {{deposit_amount}} is payable on signing. {{/deposit_amount}}The balance is due on completion and before certificates are issued. {{default_payment_terms}}. Payment methods: {{payment_methods}}. {{#bank_details}}Details: {{bank_details}}.{{/bank_details}}

## 6. Variations

Any change to the scope, price or timescale — including remedial work to unsafe existing installations discovered during the works — must be agreed **in writing** (including via Motko) before proceeding.

## 7. Timing and Access

Start: **{{start_date}}** | Estimated duration: **{{estimated_duration}}** | Estimated completion: **{{completion_date}}**. The Client will provide safe access and, where relevant, will ensure services (gas, water, electricity) can be safely isolated. {{access_arrangements}}

## 8. Materials

Materials supplied by: **{{materials_by}}**. {{materials_notes}} Materials must be suitable and compliant for regulated work; the Contractor may decline to install Client-supplied materials that do not meet the required standards.

## 9. Workmanship and Guarantee

The Contractor will carry out the work with reasonable care and skill and in compliance with the applicable regulations and standards. Workmanship is guaranteed for **{{warranty_period}}** from completion, excluding fair wear and tear, misuse, and interference or alteration by others. Manufacturer warranties apply in addition. The Client's rights under the Consumer Rights Act 2015 are unaffected.

## 10. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want work to begin within the 14-day period, request this expressly (**{{cancellation_start}}**). Safety-critical or emergency work may need to proceed immediately; in that case, if you cancel you must pay for work done and materials committed. Emergency safety work required to make an installation safe is not delayed by the cancellation period.

## 11. Insurance and Liability

The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law.

## 12. Governing Law and Disputes

Please raise any concern with the Contractor first. This contract is governed by the law of **{{governing_law}}** and subject to the courts of England & Wales.

{{#special_terms}}## 13. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}, {{registered_address}}, {{business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const MAINTENANCE_RECURRING = `# Maintenance / Recurring Service Agreement

**Use for:** ongoing or periodic work — service plans, callout retainers, regular garden maintenance, cleaning contracts, planned servicing.
*Jurisdiction: England & Wales. Draft template — have a solicitor review before use, especially the auto-renewal and cancellation terms.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}, {{business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}, of {{registered_address}}. Trade: {{trade}}. Contact: {{business_phone}} / {{business_email}}.

**The Client:** {{client_name}} of {{client_address}}. Contact: {{client_phone}} / {{client_email}}.

Agreement reference: **{{quote_reference}}** | Site: {{site_address}}

## 1. Services

The Contractor will provide the following recurring services:

> {{scope_of_work}}

**Not included:** {{exclusions}}

## 2. Schedule / Frequency

The services will be provided on the following basis:

> {{payment_schedule}}

*(Use this field to describe frequency and what each visit covers — e.g. "Monthly garden maintenance, first visit {{start_date}}"; or "Annual boiler service plus priority callouts".)* Estimated first visit: **{{start_date}}**. Typical visit duration: **{{estimated_duration}}**.

## 3. Charges and Payment

The charge is **{{total_price}}**{{#vat_registered}}, including VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}, payable {{default_payment_terms}}.

State clearly whether this is per visit, monthly, or annual in clause 2. Work outside the agreed services (e.g. repairs, parts, additional visits) is chargeable separately and will be quoted and agreed before it is carried out. Accepted payment methods: {{payment_methods}}. {{#bank_details}}Details: {{bank_details}}.{{/bank_details}}

## 4. Term and Renewal

This agreement starts on **{{start_date}}** and continues until ended by either party under clause 5. {{#special_terms}}{{special_terms}}{{/special_terms}}

If the agreement renews automatically, the Contractor will give the Client clear advance notice before each renewal and before any price change, and the Client may cancel before renewal without penalty.

## 5. Ending the Agreement

Either party may end this agreement by giving the other **reasonable written notice** (for example, 30 days), unless a different notice period is stated in clause 4. The Client will pay for services provided up to the end of the notice period. Either party may end it sooner for a serious, unremedied breach.

## 6. Access and the Client's Responsibilities

The Client will provide safe and timely access to the site for each visit, and will notify the Contractor promptly of anything affecting the service. {{access_arrangements}} Missed visits caused by lack of access may still be chargeable.

## 7. Materials and Parts

Materials/consumables provided by: **{{materials_by}}**. {{materials_notes}} Replacement parts are chargeable separately unless included in the plan described in clause 2.

## 8. Standards and Guarantee

The Contractor will provide the services with reasonable care and skill and to the standard the Client is entitled to expect under the Consumer Rights Act 2015. Any remedial workmanship is guaranteed for **{{warranty_period}}**. Where the services involve regulated work (e.g. gas servicing), the Contractor holds the relevant registrations: {{certifications}}, and building-regs / certification responsibility is: {{building_regs_responsibility}}.

## 9. Your Right to Cancel (Consumer Cancellation Rights)

As this agreement is entered into away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want services to begin within the 14-day period, request this expressly (**{{cancellation_start}}**). If you then cancel, you must pay for services provided up to cancellation.

This 14-day right is in addition to your ongoing right to end the agreement under clause 5.

## 10. Insurance and Liability

The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law. Subject to that, the Contractor is not liable for indirect or consequential loss.

## 11. Governing Law and Disputes

Please raise any concern with the Contractor first. This agreement is governed by the law of **{{governing_law}}** and subject to the courts of England & Wales.

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}, {{registered_address}}, {{business_email}}:

I/We cancel my/our service agreement: {{scope_of_work}}.
Started on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

export type ContractTemplateDefinition = {
  key: ContractTemplateKey;
  label: string;
  description: string;
  body: string;
};

export const CONTRACT_TEMPLATES: ContractTemplateDefinition[] = [
  {
    key: "small_works",
    label: "Small Works",
    description: "Single-visit or low-value jobs, paid on completion.",
    body: SMALL_WORKS,
  },
  {
    key: "standard_project",
    label: "Standard Project",
    description: "Multi-day jobs with labour + materials, deposit and balance on completion.",
    body: STANDARD_PROJECT,
  },
  {
    key: "large_staged_project",
    label: "Large / Staged Project",
    description: "Higher-value jobs paid in stages, with deposit, milestones and optional retention.",
    body: LARGE_STAGED_PROJECT,
  },
  {
    key: "regulated_certified_works",
    label: "Regulated / Certified Works",
    description: "Work requiring certification or notifiable under Building Regs (gas, electrical, etc.).",
    body: REGULATED_CERTIFIED_WORKS,
  },
  {
    key: "maintenance_recurring",
    label: "Maintenance / Recurring",
    description: "Ongoing or periodic work — service plans, callout retainers, maintenance contracts.",
    body: MAINTENANCE_RECURRING,
  },
];

export const getContractTemplate = (key: ContractTemplateKey): ContractTemplateDefinition => {
  const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error(`Unknown contract template: ${key}`);
  return template;
};
