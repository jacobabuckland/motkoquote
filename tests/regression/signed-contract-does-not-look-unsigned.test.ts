// A signed contract printed two blank ink signature lines.
//
// Reported 13 Sep. The PDF and the web view of a contract e-signed the previous
// week both carried
//
//     **Signed by the Contractor:** ______________________  Date: __________
//     **Signed by the Client:** ______________________  Date: __________
//
// under a banner confirming it was signed. The printed record of a signed
// agreement looked unsigned — and the PDF was already rendering a real
// signature section from signer_name / signed_at further down, so the ink lines
// were a duplicate as well as a contradiction.
//
// The templates no longer emit the block. `stripInkSignatures` is what fixes the
// contracts that already carry it: `contracts.rendered_body` is written once at
// creation and never re-rendered, so a body raised before that change keeps its
// copy forever.
import { describe, expect, it } from "vitest";
import { stripInkSignatures } from "@/lib/contracts/strip-ink-signatures";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";

// A stored body in the shape every template emitted before 13 Sep.
const LEGACY_BODY = `## 9. Governing Law

This contract is governed by the law of **England & Wales**.

---

**Signed by the Contractor:** ______________________  Date: __________

**Signed by the Client:** ______________________  Date: __________

---

### Schedule A — Model Cancellation Form
*(Complete and return this form only if you wish to cancel the contract.)*

Ordered on: 12 September 2026
Name: Megan Farrant
Signature (if on paper): ____________  Date: __________
`;

describe("a contract stored before the templates changed", () => {
  const cleaned = stripInkSignatures(LEGACY_BODY);

  it("no longer offers the customer an ink line to sign", () => {
    expect(cleaned).not.toContain("Signed by the Contractor:");
    expect(cleaned).not.toContain("Signed by the Client:");
  });

  it("keeps everything either side of it", () => {
    expect(cleaned).toContain("This contract is governed by the law of **England & Wales**.");
    expect(cleaned).toContain("### Schedule A — Model Cancellation Form");
  });

  it("keeps the rule between the terms and Schedule A", () => {
    const beforeSchedule = cleaned.slice(0, cleaned.indexOf("### Schedule A"));
    expect(beforeSchedule).toContain("---");
  });

  it("leaves Schedule A's paper-cancellation signature alone", () => {
    // That one is for a customer who genuinely prints and posts the model
    // cancellation form. It is not an execution block.
    expect(cleaned).toContain("Signature (if on paper): ____________");
  });
});

describe("a body that never had the block", () => {
  it("passes through untouched", () => {
    const plain = "## 1. The Work\n\nReskim three rooms.\n";
    expect(stripInkSignatures(plain)).toBe(plain);
  });
});

describe("the templates themselves", () => {
  it("no longer emit an ink execution block", () => {
    for (const template of CONTRACT_TEMPLATES) {
      expect(template.body, template.key).not.toContain("Signed by the Contractor:");
      expect(template.body, template.key).not.toContain("Signed by the Client:");
    }
  });

  it("still carry Schedule A's model cancellation form", () => {
    for (const template of CONTRACT_TEMPLATES) {
      expect(template.body, template.key).toContain("Schedule A");
    }
  });
});
