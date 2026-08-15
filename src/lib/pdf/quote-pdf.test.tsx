import { describe, expect, it } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import type { LineItem } from "@/lib/schemas/job";

// The customer-facing quote document must never render assumption_note — that
// field is contractor-facing guidance (e.g. "Estimated material cost — confirm
// against supplier price"). Bug: "When viewing the SoW it states internal
// information". Fix is at the render boundary, so this walks the element tree
// QuotePdf produces and asserts the internal note is absent from every string.
const collectText = (node: ReactNode, out: string[]): void => {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (isValidElement(node)) {
    collectText((node.props as { children?: ReactNode }).children, out);
  }
};

const estimatedMaterial: LineItem = {
  description: "Wall tiles",
  category: "materials",
  quantity: 10,
  unit: "m2",
  unit_price: 24,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: true,
  assumption_note: "Estimated material cost — confirm against supplier price",
};

const renderedText = (): string => {
  const tree = QuotePdf({
    companyName: "Acme Plumbing",
    reference: "Q-001",
    date: "1 Jan 2026",
    customerName: "Jane Doe",
    lineItems: [estimatedMaterial],
    subtotal: 240,
    vat: 0,
    total: 240,
    vatRegistered: false,
  });
  const out: string[] = [];
  collectText(tree, out);
  return out.join(" ");
};

describe("QuotePdf — customer document does not leak internal notes", () => {
  it("renders the 'Estimated' label on an estimated line", () => {
    expect(renderedText()).toContain("Estimated");
  });

  it("never renders the contractor-facing assumption_note text", () => {
    const text = renderedText();
    expect(text).not.toContain("confirm against supplier price");
    expect(text).not.toContain(estimatedMaterial.assumption_note);
  });
});
