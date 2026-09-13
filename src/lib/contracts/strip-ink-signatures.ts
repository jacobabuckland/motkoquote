// A contract that was e-signed must not print blank ink signature lines.
//
// Reported 13 Sep: a signed contract's PDF and web view both carried
//
//     **Signed by the Contractor:** ______________________  Date: __________
//     **Signed by the Client:** ______________________  Date: __________
//
// under a banner confirming the contract was signed. The printed record of a
// signed agreement looked unsigned, which is the opposite of what the document
// is for — and the PDF was already rendering a real signature section from
// `signer_name` / `signed_at` further down, so the ink lines were a duplicate
// as well as a contradiction.
//
// The templates no longer contain the block. This exists for the contracts that
// ALREADY DO: `contracts.rendered_body` is written once at creation and never
// re-rendered, so every contract raised before that change keeps its copy
// forever. Stripping at read time is what fixes those, and it is why this is a
// function over the body rather than only a template edit.
//
// Deliberately narrow:
//   * It matches the execution block and nothing else. Schedule A's
//     "Signature (if on paper): ____" belongs to the model cancellation form,
//     which the customer may genuinely print and post, and is left alone.
//   * It leaves one `---` behind, so the document keeps its rule between the
//     terms and Schedule A rather than running them together.
//   * A body without the block passes through untouched.

/** The execution block as every template emitted it, with its surrounding rules. */
const INK_SIGNATURE_BLOCK =
  /\n?-{3,}\s*\n+\*\*Signed by the Contractor:\*\*[^\n]*\n+\*\*Signed by the Client:\*\*[^\n]*\n+-{3,}\s*\n/;

/**
 * The contract body as it should be shown, with any blank ink-signature block
 * removed. Signature state is rendered separately, from the signature the
 * customer actually gave.
 */
export const stripInkSignatures = (body: string): string =>
  body.replace(INK_SIGNATURE_BLOCK, "\n---\n");
