import type { ContractVariables } from "@/lib/schemas/contract";

// Minimal Mustache subset used by the contract templates: {{var}}
// interpolation and {{#var}}...{{/var}} truthy sections.
//
// THERE IS NO {{^var}}. A template that needs to say something when a variable
// is ABSENT needs a positive flag computed in build-variables.ts — which is why
// `has_balance`, `deposit_is_whole_price` and `no_deposit` exist rather than an
// inverted `deposit_amount`. Writing `{{^deposit_amount}}` renders the tag
// itself, verbatim, into a document a customer signs.
const SECTION_PATTERN = /{{#(\w+)}}([\s\S]*?){{\/\1}}/g;
const VARIABLE_PATTERN = /{{(\w+)}}/g;

/**
 * Sections NEST, and the inner one is expanded by recursing into the body a
 * kept section contributes.
 *
 * This used to be a single non-recursive pass, on the stated grounds that "no
 * section in these templates is nested". That held until the deposit/balance
 * projection reached the remaining four templates, where the natural phrasing
 * is a balance clause that itself mentions a payment schedule. `String.replace`
 * does one left-to-right pass and never rescans what a replacement inserts, so
 * the inner `{{#payment_schedule}}` would have survived into the rendered
 * contract as literal text.
 *
 * Non-nested templates are unaffected: recursing into a body with no sections
 * left in it is a no-op. Same-NAME nesting is still not supported — the
 * backreference in SECTION_PATTERN would close the outer section on the inner
 * tag — and no template needs it.
 */
const renderSections = (body: string, variables: ContractVariables): string =>
  body.replace(SECTION_PATTERN, (_match, key: string, inner: string) =>
    variables[key] ? renderSections(inner, variables) : "",
  );

/**
 * OMISSION MUST NOT DELETE A PAYMENT CLAUSE.
 *
 * The deposit projection is driven by three flags `build-variables.ts` computes
 * together — `has_balance`, `deposit_is_whole_price`, `no_deposit`. Gating the
 * ordinary balance sentence on `has_balance` means a caller that supplies none
 * of them renders a contract with NO statement of when payment falls due, which
 * is the defect this projection exists to fix, reintroduced through the back
 * door. `{{#var}}` is the only construct there is, so an absent flag is falsy
 * and the sentence simply vanishes.
 *
 * This is the `has_pricing_history === false` trap in AGENTS.md — omission
 * silently taking the unsafe branch — and it is worth more than a note here: a
 * hand-built fixture in
 * `tests/regression/a-contract-promises-no-schedule-it-lacks.test.ts` caught it,
 * having deliberately left "everything else empty, which is exactly the state
 * the defect lived in".
 *
 * So a caller with NO view of the deposit gets exactly what the templates did
 * before the projection existed: an ordinary balance sentence, and Small Works'
 * "payment is due on completion". Any caller that sets one flag is taken at its
 * word and nothing is inferred.
 */
const withDepositDefaults = (variables: ContractVariables): ContractVariables => {
  const statesTheDeposit =
    variables.has_balance || variables.deposit_is_whole_price || variables.no_deposit;
  if (statesTheDeposit) return variables;
  return {
    ...variables,
    has_balance: "yes",
    no_deposit: variables.deposit_amount ? "" : "yes",
  };
};

export const renderContractTemplate = (body: string, variables: ContractVariables): string => {
  const resolved = withDepositDefaults(variables);
  const withSections = renderSections(body, resolved);
  return withSections.replace(VARIABLE_PATTERN, (_match, key: string) => resolved[key] ?? "");
};
