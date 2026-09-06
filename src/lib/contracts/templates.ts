import type { ContractTemplateKey } from "@/lib/schemas/contract";

// Verbatim legal template bodies. Jurisdiction: England & Wales.
//
// REVIEWED — these have been through legal review and signed off. They are no
// longer drafts, and nothing in a body may say otherwise: a customer asked to
// sign must not be told inside the agreement that it is unreviewed.
//
// Do not edit the CLAUSE wording — only the {{variable}} plumbing around it.
// That rule covers the contractual text; it does not cover authoring notes,
// which do not belong in a body at all. Guidance about WHEN to pick a template
// goes in `description` below, which renders in the contractor's template
// picker and never reaches a customer. Anything addressed to the tradesperson
// rather than to the parties belongs there, not here.
//
// AMENDED 6 Sep 2026 — all five bodies, at the owner's direction from a
// marked-up copy of a rendered Standard Project contract (see areas/motko.md).
// STANDARD_PROJECT carries the markup as annotated; the other four carry the
// same protections ported into their own clause numbering and defined terms
// ("the services" and "this agreement" in MAINTENANCE_RECURRING), so a customer
// gets the same substance whichever template the contractor picks. The rule
// above still stands for everyone else: clause wording changes come from the
// owner with the marked-up source, never from an agent's own judgement.

const SMALL_WORKS = `# Contract for Small Works

*Jurisdiction: England & Wales.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}{{#business_structure}}, {{business_structure}}{{/business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}{{#registered_address}}, of {{registered_address}}{{/registered_address}}.{{#business_contact}} Contact: {{business_contact}}.{{/business_contact}}

**The Client:** {{client_name}}{{#client_address}} of {{client_address}}{{/client_address}}.{{#client_contact}} Contact: {{client_contact}}.{{/client_contact}}

Quote reference: **{{quote_reference}}**

## 1. The Work

The Contractor agrees to carry out the following work at {{site_address}}:

> {{scope_of_work}}

{{#exclusions}}**Not included:** {{exclusions}}{{/exclusions}}

## 2. Price and Payment

The total price for the work is **{{total_price}}**{{#vat_registered}}, which includes VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}.

Payment is due **on completion** of the work, unless otherwise agreed.{{#default_payment_terms}} {{default_payment_terms}}.{{/default_payment_terms}}{{#payment_methods}} Accepted payment methods: {{payment_methods}}.{{/payment_methods}} {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}}

Practical completion occurs when the work is substantially complete and capable of its intended use. Minor defects, snagging items or aesthetic matters do not justify withholding payment.

The Client will indemnify the Contractor for reasonable debt recovery, legal and collection costs incurred in recovering overdue sums.

If any payment becomes overdue, the Contractor may suspend the work immediately on written notice until payment is received in full. Any resulting delay will not be a breach of this contract by the Contractor, and any additional costs reasonably incurred as a result are payable by the Client.

If the work required turns out to be materially different from what was described (for example, hidden damage is found), the Contractor will stop and agree any change in price with the Client before continuing. Where additional work is urgently required for reasons of safety, compliance or practicality, the Contractor may proceed without prior written approval if it is not reasonably practicable to obtain that approval first. Such work will be charged at the Contractor's prevailing rates.

## 3. Materials

{{#materials_by}}Materials will be supplied by: **{{materials_by}}**. {{/materials_by}}{{materials_notes}}

## 4. Timing

The work is expected to be carried out on or around **{{start_date}}** and to take approximately **{{estimated_duration}}**. Timings are estimates given in good faith.

The Contractor will not be liable for any delay, failure to perform, additional cost, loss or damage arising from an event beyond the Contractor's reasonable control. Those include acts or omissions of the Client or the Client's other contractors; failure to provide access, instructions, approvals or permissions the work needs; late changes or cancellation requests by the Client; unforeseen or hidden site conditions, including hazardous materials and non-compliant existing installations; adverse weather, flood, fire, epidemic or natural disaster; failure of electricity, gas, water or telecommunications; shortages or delayed delivery of labour, materials or equipment; industrial action; acts of government or changes in law; and civil unrest, malicious damage or theft.

Where such an event occurs, the Contractor is entitled to a reasonable extension of time, may recover any additional costs reasonably incurred, and may suspend the work until the event has been resolved. None of that is a breach of this contract by the Contractor.

## 5. Access

The Client will provide safe and reasonable access to the site. {{access_arrangements}}

## 6. Workmanship and Guarantee

The Contractor will carry out the work with reasonable care and skill, using materials of satisfactory quality, in line with the Client's rights under the Consumer Rights Act 2015. {{#warranty_period}}The Contractor guarantees its workmanship for **{{warranty_period}}** from completion. This guarantee does not cover fair wear and tear, misuse, or work later altered by others. {{/warranty_period}}Manufacturer warranties on materials apply in addition.

The Client must notify the Contractor of any alleged defect within **14 days** of becoming aware of it. Failure to do so may invalidate the guarantee where the delay has caused further damage or prevented investigation.

The Contractor is not responsible for defects, faults, non-compliant installations, hidden conditions or pre-existing issues found at the property unless putting them right is expressly included in the scope of work in clause 1.

## 7. Your Right to Cancel (Consumer Cancellation Rights)

Because this contract is agreed away from the Contractor's business premises (for example, in your home or online), you have the right to cancel within **14 days** of entering into it, without giving a reason, under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, tell the Contractor in a clear statement (e.g. by email to {{business_email}}) before the 14 days end. You may use the model cancellation form in Schedule A.
- **If you want the work to begin within the 14-day period**, you must expressly request this. By requesting an early start you agree that if you then cancel after the work has commenced, you must pay the Contractor a proportionate amount for work completed and materials purchased or committed to before cancellation.
- Requested early start: **{{cancellation_start}}**.

## 8. Liability

{{#insurance_disclosed}}The Contractor holds public liability insurance with {{insurer_name}} for up to {{public_liability_cover}}. {{/insurance_disclosed}}Nothing in this contract limits liability for death or personal injury caused by negligence, or for anything that cannot be limited by law.

Subject to that, the Contractor's total liability arising out of or in connection with this contract will not exceed the total amount paid under this contract or £2,000,000, whichever is lower, except where liability cannot legally be excluded.

## 9. Complaints and Dispute Resolution

If there is a problem, please raise it with the Contractor first. The Client will notify the Contractor in writing as soon as reasonably practicable of any complaint, alleged defect, incomplete work or other matter giving rise to a dispute, giving reasonable details of the issue.

The Contractor will be given a reasonable opportunity to inspect the relevant work and, where the Contractor accepts responsibility, to remedy any defect or incomplete work within a reasonable period.

The Client will not engage any third party to investigate, rectify, complete or otherwise interfere with the work, nor seek to recover the cost of any such work from the Contractor, unless the Contractor has first been given a reasonable opportunity to inspect and remedy the issue and has failed to do so within a reasonable time.

The Client will not withhold, retain, set off or deduct any payment due under this contract by reason of any alleged defect, dispute, claim or counterclaim, except where required by law.

The parties will use reasonable endeavours to resolve any dispute arising out of or in connection with this contract through good faith discussions before commencing legal proceedings. If the parties are unable to resolve the dispute within **28 days** of written notification, either party may propose that the dispute be referred to mediation.

Nothing in this clause prevents the Contractor from taking immediate action to recover any overdue sums due under this contract, nor prevents either party from seeking urgent injunctive relief or any other interim remedy available through the courts.

This contract, and any dispute or claim arising out of or in connection with it, is governed by the law of **{{governing_law}}** and the parties submit to the exclusive jurisdiction of the courts of England & Wales.

{{#special_terms}}## 10. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return this form only if you wish to cancel the contract.)*

To {{business_name}}{{#registered_address}}, {{registered_address}}{{/registered_address}}{{#business_email}}, {{business_email}}{{/business_email}}:

I/We hereby give notice that I/We cancel my/our contract for the following work: {{scope_of_work}}.

Ordered on: {{contract_date}}
Name: {{client_name}}
Address: {{client_address}}
Signature (if on paper): ____________  Date: __________
`;

const STANDARD_PROJECT = `# Contract for a Standard Project

*Jurisdiction: England & Wales.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}{{#business_structure}}, {{business_structure}}{{/business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}{{#registered_address}}, of {{registered_address}}{{/registered_address}}.{{#trade}} Trade: {{trade}}.{{/trade}}{{#business_contact}} Contact: {{business_contact}}.{{/business_contact}}

**The Client:** {{client_name}}{{#client_address}} of {{client_address}}{{/client_address}}.{{#client_contact}} Contact: {{client_contact}}.{{/client_contact}}

Quote reference: **{{quote_reference}}**{{#site_address}} | Site: {{site_address}}{{/site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

{{#exclusions}}**Excluded from this contract:** {{exclusions}}{{/exclusions}}

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

{{#deposit_amount}}- **Deposit:** {{deposit_amount}}, payable to confirm the booking and secure materials.
{{/deposit_amount}}- **Balance:** the remainder is due on completion.{{#default_payment_terms}} {{default_payment_terms}}.{{/default_payment_terms}}
- {{#payment_methods}}Accepted payment methods: {{payment_methods}}.{{/payment_methods}} {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}}

Late payment may attract interest and reasonable recovery costs under the Late Payment of Commercial Debts (Interest) Act 1998 where that Act applies. The Client will indemnify the Contractor for reasonable debt recovery, legal and collection costs incurred in recovering overdue sums.

If any payment becomes overdue, the Contractor may suspend the work immediately on written notice until payment is received in full. Any resulting delay will not be a breach of this contract by the Contractor, and any additional costs reasonably incurred as a result are payable by the Client.

## 4. Materials

{{#materials_by}}Materials will be supplied by: **{{materials_by}}**. {{/materials_by}}{{materials_notes}}

Materials supplied by the Contractor remain the Contractor's property until paid for in full. Where the Client supplies materials, the Contractor is not responsible for their quality or suitability.

## 5. Variations (Extras and Changes)

Any change to the scope of work must be agreed **in writing** (including by message or via Motko) before that work is carried out, together with any change to the price and timescale. Unforeseen conditions (e.g. hidden damage, non-compliant existing installations) will be treated as a variation.

Where additional work is urgently required for reasons of safety, compliance or practicality, the Contractor may proceed without prior written approval if it is not reasonably practicable to obtain that approval first. Such work will be charged at the Contractor's prevailing rates.

## 6. Timing

- Estimated start: **{{start_date}}**
- Estimated duration: **{{estimated_duration}}**
- Estimated completion: **{{completion_date}}**

These are good-faith estimates. The Contractor will keep the Client informed of any change to them.

The Contractor will not be liable for any delay, failure to perform, additional cost, loss, damage or extension of time arising from any event or circumstance beyond the Contractor's reasonable control. Such events include, but are not limited to:

- (a) acts or omissions of the Client, members of the Client's household, tenants, employees, agents, representatives or other contractors engaged by the Client;
- (b) failure by the Client to provide access to the site, instructions, approvals, decisions, information, utilities, parking permits, permits, consents or permissions required for the work;
- (c) late changes to the scope of the work, requests for variations, suspension requests or cancellation requests by the Client;
- (d) discovery of hidden defects, hazardous materials, asbestos-containing materials, unsafe conditions, non-compliant installations, concealed services, structural defects or any other unforeseen site conditions;
- (e) adverse weather conditions, flooding, storm, fire, epidemic, pandemic, disease outbreak, act of God or natural disaster;
- (f) interruption or failure of electricity, gas, water, telecommunications or other utilities;
- (g) shortages, unavailability, defects, increased costs or delayed delivery of labour, materials, equipment or transport;
- (h) industrial disputes, strikes, lockouts or labour shortages;
- (i) acts of government, local authorities, regulatory bodies or utility providers, including changes in law, regulations or enforcement requirements;
- (j) civil unrest, terrorism, war, threat of war, malicious damage, criminal acts, vandalism or theft; and
- (k) any other event which the Contractor could not reasonably have prevented or overcome.

Where any such event occurs:

- (i) the Contractor is entitled to a reasonable extension of time for carrying out the work;
- (ii) the Contractor may recover any additional costs, losses, expenses or charges reasonably incurred as a result of the event;
- (iii) the Contractor may suspend the work until the event has been resolved; and
- (iv) such delay, suspension or failure will not be a breach of this contract by the Contractor.

## 7. Access, Site and Welfare

The Client will provide safe access, and reasonable use of water, power and welfare facilities where needed. {{access_arrangements}} The Contractor will keep the working area reasonably tidy and remove its own waste unless agreed otherwise.

## 8. Workmanship, Standards and Guarantee

The Contractor will perform the work with reasonable care and skill and in accordance with relevant standards and, where applicable, the Building Regulations. In line with the Consumer Rights Act 2015, the work will be carried out to a satisfactory standard and materials will be of satisfactory quality.

{{#warranty_period}}The Contractor guarantees its workmanship for **{{warranty_period}}** from completion. The guarantee excludes fair wear and tear, misuse, neglect, and work subsequently altered by others. {{/warranty_period}}Manufacturer warranties apply in addition.

The Client must notify the Contractor of any alleged defect within **14 days** of becoming aware of it. Failure to do so may invalidate the guarantee where the delay has caused further damage or prevented investigation.

The Contractor is not responsible for defects, faults, non-compliant installations, hidden conditions or pre-existing issues found at the property unless putting them right is expressly included in the scope of work in clause 1.

## 9. Completion and Sign-Off

The work is complete when it has been carried out in accordance with clause 1 (subject to any agreed variations). The Client will be invited to inspect and sign off on completion. Minor snagging items will be listed and put right within a reasonable time and do not delay payment of the balance.

Practical completion occurs when the work is substantially complete and capable of its intended use. Minor defects, snagging items or aesthetic matters do not justify withholding payment.

## 10. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it, without giving a reason, under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor in a clear statement (e.g. email {{business_email}}) within the 14 days. You may use the form in Schedule A.
- **Early start:** if you want work to begin within the 14-day period you must request this expressly (**{{cancellation_start}}**). If you then cancel after the work has commenced, you must pay the Contractor a proportionate amount for work completed and materials purchased or committed to before cancellation.

## 11. Insurance and Liability

{{#insurance_disclosed}}The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. {{/insurance_disclosed}}Nothing limits liability for death or personal injury from negligence, fraud, or anything that cannot be excluded by law. Otherwise, the Contractor is not liable for indirect or consequential loss.

Subject to that, the Contractor's total liability arising out of or in connection with this contract will not exceed the total amount paid under this contract or £2,000,000, whichever is lower, except where liability cannot legally be excluded.

## 12. Complaints and Dispute Resolution

If there is a problem, please raise it with the Contractor first. The Client will notify the Contractor in writing as soon as reasonably practicable of any complaint, alleged defect, incomplete work or other matter giving rise to a dispute, giving reasonable details of the issue.

The Contractor will be given a reasonable opportunity to inspect the relevant work and, where the Contractor accepts responsibility, to remedy any defect or incomplete work within a reasonable period.

The Client will not engage any third party to investigate, rectify, complete or otherwise interfere with the work, nor seek to recover the cost of any such work from the Contractor, unless the Contractor has first been given a reasonable opportunity to inspect and remedy the issue and has failed to do so within a reasonable time.

The Client will not withhold, retain, set off or deduct any payment due under this contract by reason of any alleged defect, dispute, claim or counterclaim, except where required by law.

The parties will use reasonable endeavours to resolve any dispute arising out of or in connection with this contract through good faith discussions before commencing legal proceedings. If the parties are unable to resolve the dispute within **28 days** of written notification, either party may propose that the dispute be referred to mediation.

Nothing in this clause prevents the Contractor from taking immediate action to recover any overdue sums due under this contract, nor prevents either party from seeking urgent injunctive relief or any other interim remedy available through the courts.

This contract, and any dispute or claim arising out of or in connection with it, is governed by the law of **{{governing_law}}** and the parties submit to the exclusive jurisdiction of the courts of England & Wales.

{{#special_terms}}## 13. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}{{#registered_address}}, {{registered_address}}{{/registered_address}}{{#business_email}}, {{business_email}}{{/business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const LARGE_STAGED_PROJECT = `# Contract for a Large / Staged Project

*Jurisdiction: England & Wales.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}{{#business_structure}}, {{business_structure}}{{/business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}{{#registered_address}}, of {{registered_address}}{{/registered_address}}.{{#trade}} Trade: {{trade}}.{{/trade}}{{#certifications}} Certifications: {{certifications}}.{{/certifications}}{{#business_contact}} Contact: {{business_contact}}.{{/business_contact}}

**The Client:** {{client_name}}{{#client_address}} of {{client_address}}{{/client_address}}.{{#client_contact}} Contact: {{client_contact}}.{{/client_contact}}

Quote reference: **{{quote_reference}}**{{#site_address}} | Site: {{site_address}}{{/site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

{{#exclusions}}**Excluded:** {{exclusions}}{{/exclusions}}

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

{{#deposit_amount}}- **Deposit:** {{deposit_amount}}, payable on signing to confirm the booking and order materials.
{{/deposit_amount}}- **Stage payments:** the balance is payable against completed milestones as set out below. Each stage becomes due when that stage is complete and the Contractor has issued an invoice.

> {{payment_schedule}}

{{#default_payment_terms}}Each stage invoice is payable within the terms in {{default_payment_terms}}. {{/default_payment_terms}}{{#payment_methods}}Accepted payment methods: {{payment_methods}}.{{/payment_methods}} {{#bank_details}}Payment details: {{bank_details}}.{{/bank_details}}

The Client will indemnify the Contractor for reasonable debt recovery, legal and collection costs incurred in recovering overdue sums.

If any payment becomes overdue, the Contractor may suspend the work immediately on written notice until payment is received in full. Any resulting delay will not be a breach of this contract by the Contractor, and any additional costs reasonably incurred as a result are payable by the Client.

## 4. Retention (optional)

Where a retention is agreed, the Client may hold back a small agreed percentage of each stage payment (stated in the payment schedule), released once any snagging listed at completion is signed off, and no later than a reasonable period after completion.

## 5. Materials and Title

{{#materials_by}}Materials supplied by: **{{materials_by}}**. {{/materials_by}}{{materials_notes}} Materials supplied by the Contractor remain its property until paid for. Risk in installed works passes to the Client on installation.

## 6. Variations

No variation to the scope, price or programme is binding unless agreed **in writing** (including via Motko) before the varied work is done. The Contractor will provide the cost and any programme impact of a variation before proceeding. Unforeseen ground, structural or existing-installation conditions are variations.

Where additional work is urgently required for reasons of safety, compliance or practicality, the Contractor may proceed without prior written approval if it is not reasonably practicable to obtain that approval first. Such work will be charged at the Contractor's prevailing rates.

## 7. Programme and Delays

- Start: **{{start_date}}** | Estimated duration: **{{estimated_duration}}** | Estimated completion: **{{completion_date}}**

Dates are estimates given in good faith. The completion date will be reasonably extended for variations and for late decisions or payments by the Client.

The Contractor will not be liable for any delay, failure to perform, additional cost, loss, damage or extension of time arising from any event or circumstance beyond the Contractor's reasonable control. Such events include, but are not limited to:

- (a) acts or omissions of the Client, members of the Client's household, tenants, employees, agents, representatives or other contractors engaged by the Client;
- (b) failure by the Client to provide access to the site, instructions, approvals, decisions, information, utilities, parking permits, permits, consents or permissions required for the work;
- (c) late changes to the scope of the work, requests for variations, suspension requests or cancellation requests by the Client;
- (d) discovery of hidden defects, hazardous materials, asbestos-containing materials, unsafe conditions, non-compliant installations, concealed services, structural defects or any other unforeseen site conditions;
- (e) adverse weather conditions, flooding, storm, fire, epidemic, pandemic, disease outbreak, act of God or natural disaster;
- (f) interruption or failure of electricity, gas, water, telecommunications or other utilities;
- (g) shortages, unavailability, defects, increased costs or delayed delivery of labour, materials, equipment or transport;
- (h) industrial disputes, strikes, lockouts or labour shortages;
- (i) acts of government, local authorities, regulatory bodies or utility providers, including changes in law, regulations or enforcement requirements;
- (j) civil unrest, terrorism, war, threat of war, malicious damage, criminal acts, vandalism or theft; and
- (k) any other event which the Contractor could not reasonably have prevented or overcome.

Where any such event occurs:

- (i) the Contractor is entitled to a reasonable extension of time for carrying out the work;
- (ii) the Contractor may recover any additional costs, losses, expenses or charges reasonably incurred as a result of the event;
- (iii) the Contractor may suspend the work until the event has been resolved; and
- (iv) such delay, suspension or failure will not be a breach of this contract by the Contractor.

## 8. Access, Site and Welfare

The Client will give the Contractor clear and safe access to the site for the duration of the works, and reasonable use of power, water and welfare facilities. {{access_arrangements}} The Client is responsible for obtaining any planning permission, party-wall agreements or third-party consents unless agreed otherwise in writing.

## 9. Standards, Building Regulations and Guarantee

The Contractor will carry out the work with reasonable care and skill, in accordance with relevant British Standards and the Building Regulations.{{#building_regs_responsibility}} Responsibility for building-regulations notification and certification: **{{building_regs_responsibility}}**.{{/building_regs_responsibility}}

{{#warranty_period}}The Contractor guarantees its workmanship for **{{warranty_period}}** from completion, excluding fair wear and tear, misuse, and work later altered by others. {{/warranty_period}}Manufacturer and structural warranties apply in addition. The Client's statutory rights under the Consumer Rights Act 2015 are unaffected.

The Client must notify the Contractor of any alleged defect within **14 days** of becoming aware of it. Failure to do so may invalidate the guarantee where the delay has caused further damage or prevented investigation.

The Contractor is not responsible for defects, faults, non-compliant installations, hidden conditions or pre-existing issues found at the property unless putting them right is expressly included in the scope of work in clause 1.

## 10. Completion and Snagging

On practical completion the Contractor and Client will inspect the works together and agree a snagging list of any minor items. The Contractor will complete snagging within a reasonable period. Practical completion is not delayed by minor snagging.

Practical completion occurs when the work is substantially complete and capable of its intended use. Minor defects, snagging items or aesthetic matters do not justify withholding payment.

## 11. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want work or material orders to begin within the 14-day period you must request this expressly (**{{cancellation_start}}**). If you then cancel after the work has commenced, you must pay the Contractor a proportionate amount for work completed and materials purchased or committed to before cancellation.

## 12. Suspension and Termination

Either party may end this contract for a serious, unremedied breach by the other after giving reasonable written notice. On termination the Client will pay for all work properly carried out and materials reasonably ordered up to that date.

## 13. Insurance and Liability

{{#insurance_disclosed}}The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. {{/insurance_disclosed}}Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law. Otherwise, the Contractor is not liable for indirect or consequential loss.

Subject to that, the Contractor's total liability arising out of or in connection with this contract will not exceed the total amount paid under this contract or £2,000,000, whichever is lower, except where liability cannot legally be excluded.

## 14. Complaints and Dispute Resolution

If there is a problem, please raise it with the Contractor first. The Client will notify the Contractor in writing as soon as reasonably practicable of any complaint, alleged defect, incomplete work or other matter giving rise to a dispute, giving reasonable details of the issue.

The Contractor will be given a reasonable opportunity to inspect the relevant work and, where the Contractor accepts responsibility, to remedy any defect or incomplete work within a reasonable period.

The Client will not engage any third party to investigate, rectify, complete or otherwise interfere with the work, nor seek to recover the cost of any such work from the Contractor, unless the Contractor has first been given a reasonable opportunity to inspect and remedy the issue and has failed to do so within a reasonable time.

The Client will not withhold, retain, set off or deduct any payment due under this contract by reason of any alleged defect, dispute, claim or counterclaim, except where required by law.

The parties will use reasonable endeavours to resolve any dispute arising out of or in connection with this contract through good faith discussions before commencing legal proceedings. If the parties are unable to resolve the dispute within **28 days** of written notification, either party may propose that the dispute be referred to mediation.

Nothing in this clause prevents the Contractor from taking immediate action to recover any overdue sums due under this contract, nor prevents either party from seeking urgent injunctive relief or any other interim remedy available through the courts.

This contract, and any dispute or claim arising out of or in connection with it, is governed by the law of **{{governing_law}}** and the parties submit to the exclusive jurisdiction of the courts of England & Wales.

{{#special_terms}}## 15. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}{{#registered_address}}, {{registered_address}}{{/registered_address}}{{#business_email}}, {{business_email}}{{/business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const REGULATED_CERTIFIED_WORKS = `# Contract for Regulated / Certified Works

*Jurisdiction: England & Wales.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}{{#business_structure}}, {{business_structure}}{{/business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}{{#registered_address}}, of {{registered_address}}{{/registered_address}}.{{#trade}} Trade: {{trade}}.{{/trade}}{{#business_contact}} Contact: {{business_contact}}.{{/business_contact}}

{{#certifications}}**Registrations & accreditations:** {{certifications}}{{/certifications}}

**The Client:** {{client_name}}{{#client_address}} of {{client_address}}{{/client_address}}.{{#client_contact}} Contact: {{client_contact}}.{{/client_contact}}

Quote reference: **{{quote_reference}}**{{#site_address}} | Site: {{site_address}}{{/site_address}}

## 1. Scope of Work

The Contractor will carry out the following work:

> {{scope_of_work}}

{{#exclusions}}**Excluded:** {{exclusions}}{{/exclusions}}

## 2. Competence and Registration

The Contractor confirms it holds, and will maintain for the duration of the work, the registrations listed above{{#certifications}} ({{certifications}}){{/certifications}} that are required to carry out this work lawfully. Only appropriately registered and competent operatives will carry out the notifiable elements. The Contractor will provide its registration details on request.

## 3. Building Regulations, Notification and Certification

This work includes elements that are notifiable and/or require certification.{{#building_regs_responsibility}} Responsibility for notification and certification is: **{{building_regs_responsibility}}**.{{/building_regs_responsibility}}

Where the Contractor is responsible, it will (as applicable):

- carry out the work to the relevant standards (e.g. BS 7671 for electrical installations; Gas Safety (Installation and Use) Regulations 1998 for gas work);
- notify the work under the relevant competent-person scheme or to Building Control; and
- provide the Client with the appropriate certificate(s) — for example an Electrical Installation Certificate / EICR, Gas Safety Record, or Building Regulations Compliance Certificate — on completion and payment.

Certificates will be issued once the work is complete and paid for in accordance with clause 5.

## 4. Inspection, Testing and Handover

The Contractor will inspect and test the work as required by the applicable standards before handover, and will explain to the Client any actions the Client must take (for example, servicing intervals or safe-use guidance). Where pre-existing installations are found to be unsafe or non-compliant, the Contractor will inform the Client; remedying them is a variation under clause 6.

Practical completion occurs when the work is substantially complete and capable of its intended use. Minor defects, snagging items or aesthetic matters do not justify withholding payment.

## 5. Price and Payment

The total price for the work is **{{total_price}}**{{#vat_registered}}, including VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}.

{{#deposit_amount}}A deposit of {{deposit_amount}} is payable on signing. {{/deposit_amount}}The balance is due on completion and before certificates are issued.{{#default_payment_terms}} {{default_payment_terms}}.{{/default_payment_terms}}{{#payment_methods}} Payment methods: {{payment_methods}}.{{/payment_methods}} {{#bank_details}}Details: {{bank_details}}.{{/bank_details}}

The Client will indemnify the Contractor for reasonable debt recovery, legal and collection costs incurred in recovering overdue sums.

If any payment becomes overdue, the Contractor may suspend the work immediately on written notice until payment is received in full. Any resulting delay will not be a breach of this contract by the Contractor, and any additional costs reasonably incurred as a result are payable by the Client.

## 6. Variations

Any change to the scope, price or timescale — including remedial work to unsafe existing installations discovered during the works — must be agreed **in writing** (including via Motko) before proceeding.

By way of exception to the paragraph above: where additional work is urgently required for reasons of safety, compliance or practicality, the Contractor may proceed without prior written approval if it is not reasonably practicable to obtain that approval first. Such work will be charged at the Contractor's prevailing rates.

## 7. Timing and Access

Start: **{{start_date}}** | Estimated duration: **{{estimated_duration}}** | Estimated completion: **{{completion_date}}**. The Client will provide safe access and, where relevant, will ensure services (gas, water, electricity) can be safely isolated. {{access_arrangements}}

The Contractor will not be liable for any delay, failure to perform, additional cost, loss, damage or extension of time arising from any event or circumstance beyond the Contractor's reasonable control. Such events include, but are not limited to:

- (a) acts or omissions of the Client, members of the Client's household, tenants, employees, agents, representatives or other contractors engaged by the Client;
- (b) failure by the Client to provide access to the site, instructions, approvals, decisions, information, utilities, parking permits, permits, consents or permissions required for the work;
- (c) late changes to the scope of the work, requests for variations, suspension requests or cancellation requests by the Client;
- (d) discovery of hidden defects, hazardous materials, asbestos-containing materials, unsafe conditions, non-compliant installations, concealed services, structural defects or any other unforeseen site conditions;
- (e) adverse weather conditions, flooding, storm, fire, epidemic, pandemic, disease outbreak, act of God or natural disaster;
- (f) interruption or failure of electricity, gas, water, telecommunications or other utilities;
- (g) shortages, unavailability, defects, increased costs or delayed delivery of labour, materials, equipment or transport;
- (h) industrial disputes, strikes, lockouts or labour shortages;
- (i) acts of government, local authorities, regulatory bodies or utility providers, including changes in law, regulations or enforcement requirements;
- (j) civil unrest, terrorism, war, threat of war, malicious damage, criminal acts, vandalism or theft; and
- (k) any other event which the Contractor could not reasonably have prevented or overcome.

Where any such event occurs:

- (i) the Contractor is entitled to a reasonable extension of time for carrying out the work;
- (ii) the Contractor may recover any additional costs, losses, expenses or charges reasonably incurred as a result of the event;
- (iii) the Contractor may suspend the work until the event has been resolved; and
- (iv) such delay, suspension or failure will not be a breach of this contract by the Contractor.

## 8. Materials

{{#materials_by}}Materials supplied by: **{{materials_by}}**. {{/materials_by}}{{materials_notes}} Materials must be suitable and compliant for regulated work; the Contractor may decline to install Client-supplied materials that do not meet the required standards.

## 9. Workmanship and Guarantee

The Contractor will carry out the work with reasonable care and skill and in compliance with the applicable regulations and standards. {{#warranty_period}}Workmanship is guaranteed for **{{warranty_period}}** from completion, excluding fair wear and tear, misuse, and interference or alteration by others. {{/warranty_period}}Manufacturer warranties apply in addition. The Client's rights under the Consumer Rights Act 2015 are unaffected.

The Client must notify the Contractor of any alleged defect within **14 days** of becoming aware of it. Failure to do so may invalidate the guarantee where the delay has caused further damage or prevented investigation.

The Contractor is not responsible for defects, faults, non-compliant installations, hidden conditions or pre-existing issues found at the property unless putting them right is expressly included in the scope of work in clause 1.

## 10. Your Right to Cancel (Consumer Cancellation Rights)

As this contract is agreed away from the Contractor's business premises, you have the right to cancel within **14 days** under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want work to begin within the 14-day period, request this expressly (**{{cancellation_start}}**). Safety-critical or emergency work may need to proceed immediately. If you cancel after the work has commenced, you must pay the Contractor a proportionate amount for work completed and materials purchased or committed to before cancellation. Emergency safety work required to make an installation safe is not delayed by the cancellation period.

## 11. Insurance and Liability

{{#insurance_disclosed}}The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. {{/insurance_disclosed}}Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law.

Subject to that, the Contractor's total liability arising out of or in connection with this contract will not exceed the total amount paid under this contract or £2,000,000, whichever is lower, except where liability cannot legally be excluded.

## 12. Complaints and Dispute Resolution

If there is a problem, please raise it with the Contractor first. The Client will notify the Contractor in writing as soon as reasonably practicable of any complaint, alleged defect, incomplete work or other matter giving rise to a dispute, giving reasonable details of the issue.

The Contractor will be given a reasonable opportunity to inspect the relevant work and, where the Contractor accepts responsibility, to remedy any defect or incomplete work within a reasonable period.

The Client will not engage any third party to investigate, rectify, complete or otherwise interfere with the work, nor seek to recover the cost of any such work from the Contractor, unless the Contractor has first been given a reasonable opportunity to inspect and remedy the issue and has failed to do so within a reasonable time.

The Client will not withhold, retain, set off or deduct any payment due under this contract by reason of any alleged defect, dispute, claim or counterclaim, except where required by law.

The parties will use reasonable endeavours to resolve any dispute arising out of or in connection with this contract through good faith discussions before commencing legal proceedings. If the parties are unable to resolve the dispute within **28 days** of written notification, either party may propose that the dispute be referred to mediation.

Nothing in this clause prevents the Contractor from taking immediate action to recover any overdue sums due under this contract, nor prevents either party from seeking urgent injunctive relief or any other interim remedy available through the courts.

This contract, and any dispute or claim arising out of or in connection with it, is governed by the law of **{{governing_law}}** and the parties submit to the exclusive jurisdiction of the courts of England & Wales.

{{#special_terms}}## 13. Additional Terms

{{special_terms}}{{/special_terms}}

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}{{#registered_address}}, {{registered_address}}{{/registered_address}}{{#business_email}}, {{business_email}}{{/business_email}}:

I/We cancel my/our contract for: {{scope_of_work}}.
Ordered on: {{contract_date}} | Name: {{client_name}} | Address: {{client_address}}
Signature: ____________  Date: __________
`;

const MAINTENANCE_RECURRING = `# Maintenance / Recurring Service Agreement

*Jurisdiction: England & Wales.*

---

**This Agreement is made on {{contract_date}} between:**

**The Contractor:** {{business_name}}{{#trading_name}} (trading as {{trading_name}}){{/trading_name}}{{#business_structure}}, {{business_structure}}{{/business_structure}}{{#company_number}}, company number {{company_number}}{{/company_number}}{{#registered_address}}, of {{registered_address}}{{/registered_address}}.{{#trade}} Trade: {{trade}}.{{/trade}}{{#business_contact}} Contact: {{business_contact}}.{{/business_contact}}

**The Client:** {{client_name}}{{#client_address}} of {{client_address}}{{/client_address}}.{{#client_contact}} Contact: {{client_contact}}.{{/client_contact}}

Agreement reference: **{{quote_reference}}**{{#site_address}} | Site: {{site_address}}{{/site_address}}

## 1. Services

The Contractor will provide the following recurring services:

> {{scope_of_work}}

{{#exclusions}}**Not included:** {{exclusions}}{{/exclusions}}

## 2. Schedule / Frequency

The services will be provided on the following basis:

> {{payment_schedule}}

Estimated first visit: **{{start_date}}**. Typical visit duration: **{{estimated_duration}}**.

The Contractor will not be liable for any delay, failure to perform, additional cost, loss, damage or extension of time arising from any event or circumstance beyond the Contractor's reasonable control. Such events include, but are not limited to:

- (a) acts or omissions of the Client, members of the Client's household, tenants, employees, agents, representatives or other contractors engaged by the Client;
- (b) failure by the Client to provide access to the site, instructions, approvals, decisions, information, utilities, parking permits, permits, consents or permissions required for the services;
- (c) late changes to the scope of the services, requests for variations, suspension requests or cancellation requests by the Client;
- (d) discovery of hidden defects, hazardous materials, asbestos-containing materials, unsafe conditions, non-compliant installations, concealed services, structural defects or any other unforeseen site conditions;
- (e) adverse weather conditions, flooding, storm, fire, epidemic, pandemic, disease outbreak, act of God or natural disaster;
- (f) interruption or failure of electricity, gas, water, telecommunications or other utilities;
- (g) shortages, unavailability, defects, increased costs or delayed delivery of labour, materials, equipment or transport;
- (h) industrial disputes, strikes, lockouts or labour shortages;
- (i) acts of government, local authorities, regulatory bodies or utility providers, including changes in law, regulations or enforcement requirements;
- (j) civil unrest, terrorism, war, threat of war, malicious damage, criminal acts, vandalism or theft; and
- (k) any other event which the Contractor could not reasonably have prevented or overcome.

Where any such event occurs:

- (i) the Contractor is entitled to a reasonable extension of time for carrying out the services;
- (ii) the Contractor may recover any additional costs, losses, expenses or charges reasonably incurred as a result of the event;
- (iii) the Contractor may suspend the services until the event has been resolved; and
- (iv) such delay, suspension or failure will not be a breach of this agreement by the Contractor.

## 3. Charges and Payment

The charge is **{{total_price}}**{{#vat_registered}}, including VAT of {{vat_amount}} (VAT no. {{vat_number}}){{/vat_registered}}.{{#default_payment_terms}} Payable {{default_payment_terms}}.{{/default_payment_terms}}

Work outside the agreed services (e.g. repairs, parts, additional visits) is chargeable separately and will be quoted and agreed before it is carried out.{{#payment_methods}} Accepted payment methods: {{payment_methods}}.{{/payment_methods}} {{#bank_details}}Details: {{bank_details}}.{{/bank_details}}

Where additional work is urgently required for reasons of safety, compliance or practicality, the Contractor may proceed without prior written approval if it is not reasonably practicable to obtain that approval first. Such work will be charged at the Contractor's prevailing rates.

The Client will indemnify the Contractor for reasonable debt recovery, legal and collection costs incurred in recovering overdue sums.

If any payment becomes overdue, the Contractor may suspend the services immediately on written notice until payment is received in full. Any resulting delay will not be a breach of this agreement by the Contractor, and any additional costs reasonably incurred as a result are payable by the Client.

## 4. Term and Renewal

This agreement starts on **{{start_date}}** and continues until ended by either party under clause 5. {{#special_terms}}{{special_terms}}{{/special_terms}}

If the agreement renews automatically, the Contractor will give the Client clear advance notice before each renewal and before any price change, and the Client may cancel before renewal without penalty.

## 5. Ending the Agreement

Either party may end this agreement by giving the other **reasonable written notice** (for example, 30 days), unless a different notice period is stated in clause 4. The Client will pay for services provided up to the end of the notice period. Either party may end it sooner for a serious, unremedied breach.

## 6. Access and the Client's Responsibilities

The Client will provide safe and timely access to the site for each visit, and will notify the Contractor promptly of anything affecting the service. {{access_arrangements}} Missed visits caused by lack of access may still be chargeable.

## 7. Materials and Parts

{{#materials_by}}Materials/consumables provided by: **{{materials_by}}**. {{/materials_by}}{{materials_notes}} Replacement parts are chargeable separately unless included in the plan described in clause 2.

## 8. Standards and Guarantee

The Contractor will provide the services with reasonable care and skill and to the standard the Client is entitled to expect under the Consumer Rights Act 2015. {{#warranty_period}}Any remedial workmanship is guaranteed for **{{warranty_period}}**. {{/warranty_period}}Where the services involve regulated work (e.g. gas servicing),{{#certifications}} the Contractor holds the relevant registrations: {{certifications}}{{/certifications}}{{#building_regs_responsibility}} and building-regs / certification responsibility is: {{building_regs_responsibility}}{{/building_regs_responsibility}}.

A visit is complete when the services described in clause 2 for that visit have been substantially carried out. Minor defects, snagging items or aesthetic matters do not justify withholding payment.

The Client must notify the Contractor of any alleged defect within **14 days** of becoming aware of it. Failure to do so may invalidate the guarantee where the delay has caused further damage or prevented investigation.

The Contractor is not responsible for defects, faults, non-compliant installations, hidden conditions or pre-existing issues found at the property unless putting them right is expressly included in the services described in clause 1.

## 9. Your Right to Cancel (Consumer Cancellation Rights)

As this agreement is entered into away from the Contractor's business premises, you have the right to cancel within **14 days** of entering into it under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.

- To cancel, notify the Contractor clearly (e.g. email {{business_email}}) within the 14 days; you may use Schedule A.
- **Early start:** if you want services to begin within the 14-day period, request this expressly (**{{cancellation_start}}**). If you then cancel after the services have commenced, you must pay the Contractor a proportionate amount for services provided and materials purchased or committed to before cancellation.

This 14-day right is in addition to your ongoing right to end the agreement under clause 5.

## 10. Insurance and Liability

{{#insurance_disclosed}}The Contractor holds public liability insurance with {{insurer_name}} up to {{public_liability_cover}}. {{/insurance_disclosed}}Nothing limits liability for death or personal injury caused by negligence, fraud, or anything that cannot be excluded by law. Otherwise, the Contractor is not liable for indirect or consequential loss.

Subject to that, the Contractor's total liability arising out of or in connection with this agreement will not exceed the total amount paid under this agreement or £2,000,000, whichever is lower, except where liability cannot legally be excluded.

## 11. Complaints and Dispute Resolution

If there is a problem, please raise it with the Contractor first. The Client will notify the Contractor in writing as soon as reasonably practicable of any complaint, alleged defect, incomplete work or other matter giving rise to a dispute, giving reasonable details of the issue.

The Contractor will be given a reasonable opportunity to inspect the relevant work and, where the Contractor accepts responsibility, to remedy any defect or incomplete work within a reasonable period.

The Client will not engage any third party to investigate, rectify, complete or otherwise interfere with the services, nor seek to recover the cost of any such work from the Contractor, unless the Contractor has first been given a reasonable opportunity to inspect and remedy the issue and has failed to do so within a reasonable time.

The Client will not withhold, retain, set off or deduct any payment due under this agreement by reason of any alleged defect, dispute, claim or counterclaim, except where required by law.

The parties will use reasonable endeavours to resolve any dispute arising out of or in connection with this agreement through good faith discussions before commencing legal proceedings. If the parties are unable to resolve the dispute within **28 days** of written notification, either party may propose that the dispute be referred to mediation.

Nothing in this clause prevents the Contractor from taking immediate action to recover any overdue sums due under this agreement, nor prevents either party from seeking urgent injunctive relief or any other interim remedy available through the courts.

This agreement, and any dispute or claim arising out of or in connection with it, is governed by the law of **{{governing_law}}** and the parties submit to the exclusive jurisdiction of the courts of England & Wales.

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return only if you wish to cancel.)*

To {{business_name}}{{#registered_address}}, {{registered_address}}{{/registered_address}}{{#business_email}}, {{business_email}}{{/business_email}}:

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
    // Carries the two authoring notes that used to sit in the body: when this
    // template applies, and the one thing it must never be used to do. The
    // registration warning is a compliance guard addressed to the tradesperson,
    // so it belongs here — in front of them at the moment they choose — and not
    // in the customer's copy of the agreement.
    description:
      "Work requiring certification or notifiable under Building Regs (gas, electrical, etc.). " +
      "Can be used standalone, or its compliance clauses (2, 3, 4) bolted onto the Standard or " +
      "Large / Staged Project templates. Do not use it to imply a registration you do not hold.",
    body: REGULATED_CERTIFIED_WORKS,
  },
  {
    key: "maintenance_recurring",
    label: "Maintenance / Recurring",
    // Carries the two authoring notes that used to sit in clauses 2 and 3 of the
    // body, where they rendered in the customer's copy of the agreement: how to
    // fill the schedule field, and the reminder to state the charging basis.
    // Both are addressed to the tradesperson, so they belong in front of them at
    // the moment they choose the template.
    description:
      "Ongoing or periodic work — service plans, callout retainers, maintenance contracts. " +
      "Use the schedule field for frequency and what each visit covers (e.g. \"Monthly garden " +
      "maintenance\"; or \"Annual boiler service plus priority callouts\"), and state there whether " +
      "the charge is per visit, monthly or annual.",
    body: MAINTENANCE_RECURRING,
  },
];

export const getContractTemplate = (key: ContractTemplateKey): ContractTemplateDefinition => {
  const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error(`Unknown contract template: ${key}`);
  return template;
};
