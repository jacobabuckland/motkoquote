import type { ContractVariables } from "@/lib/schemas/contract";

// Minimal Mustache subset used by the contract templates: {{var}}
// interpolation and {{#var}}...{{/var}} truthy sections. Sections in these
// templates are never nested, so a single non-recursive pass is sufficient.
const SECTION_PATTERN = /{{#(\w+)}}([\s\S]*?){{\/\1}}/g;
const VARIABLE_PATTERN = /{{(\w+)}}/g;

export const renderContractTemplate = (body: string, variables: ContractVariables): string => {
  const withSections = body.replace(SECTION_PATTERN, (_match, key: string, inner: string) =>
    variables[key] ? inner : "",
  );
  return withSections.replace(VARIABLE_PATTERN, (_match, key: string) => variables[key] ?? "");
};
