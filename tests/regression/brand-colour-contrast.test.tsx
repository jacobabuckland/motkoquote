/**
 * @vitest-environment happy-dom
 */

// Settings → Branding accepts any colour, with no validation and no preview.
// The reported account has #FEF7B8, a pale yellow — 1.1:1 against white. Set as
// the company name on a quote, that name is invisible on the customer's copy,
// and worse on paper than on a backlit screen because paper is not lit.
//
// The failure is silent to the person who caused it: the trade never sees the
// customer's copy.
//
// The decision (2026-08-25) was (d) — constrain the DESIGN, not the input. The
// colour is stored exactly as the trade set it and is still used everywhere it
// cannot fail. Only the roles that paint TEXT decline it.
//
// Which roles those are had to be enumerated before any of this could be
// written, and the enumeration is the substance of the fix:
//
//   monogram fill (PdfHeader, <Monogram/>)  — fill; getContrastingTextColor
//                                             picks initials against it, so it
//                                             cannot fail. Untouched.
//   company name (PdfHeader)                — TEXT on white paper. Guarded.
//   <h1> on /q/[id] and /c/[id]             — TEXT on a near-white surface.
//                                             Guarded.
//   PdfAccentBar, sectionTitle underline    — rules. Carry no text, so a pale
//                                             one reads as unbranded rather
//                                             than broken. Untouched by
//                                             intent, asserted below.
import { describe, expect, it } from "vitest";
import {
  BRAND_TEXT_MIN_CONTRAST,
  DOCUMENT_PAPER,
  brandColorReadableAsText,
  contrastRatio,
  getContrastingTextColor,
  relativeLuminance,
} from "@/lib/color-contrast";

const PALE_YELLOW = "#FEF7B8"; // the reported account's colour
const MOTKO_GREEN = "#004225"; // the default

describe("contrastRatio", () => {
  it("puts black on white at the maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("puts a colour against itself at the minimum", () => {
    expect(contrastRatio(PALE_YELLOW, PALE_YELLOW)).toBeCloseTo(1, 5);
  });

  it("is symmetric — the order of the two colours cannot matter", () => {
    expect(contrastRatio(PALE_YELLOW, "#FFFFFF")).toBe(
      contrastRatio("#FFFFFF", PALE_YELLOW),
    );
  });

  it("reports null rather than a number it cannot compute", () => {
    // Null, not a fallback: a caller deciding whether a colour is SAFE must be
    // able to tell "unsafe" from "unreadable". Treating a bad value as black
    // would silently call it safe.
    expect(contrastRatio("not a colour", "#FFFFFF")).toBeNull();
    expect(relativeLuminance("#12345")).toBeNull();
    expect(relativeLuminance("")).toBeNull();
  });

  it("reads a 3-digit hex and a hash-less hex", () => {
    expect(relativeLuminance("#fff")).toBe(relativeLuminance("#FFFFFF"));
    expect(relativeLuminance("FFFFFF")).toBe(relativeLuminance("#FFFFFF"));
  });
});

describe("brandColorReadableAsText", () => {
  it("refuses the reported pale yellow", () => {
    // The whole point. 1.1:1 on white.
    expect(contrastRatio(PALE_YELLOW, DOCUMENT_PAPER)!).toBeLessThan(
      BRAND_TEXT_MIN_CONTRAST,
    );
    expect(
      brandColorReadableAsText(PALE_YELLOW),
      "a company name in #FEF7B8 is invisible on the customer's copy",
    ).toBe(false);
  });

  it("accepts the default green, so the ordinary document is unchanged", () => {
    // If this ever fails, the guard has started rewriting every unbranded
    // document in the product rather than the handful with a pale colour.
    expect(brandColorReadableAsText(MOTKO_GREEN)).toBe(true);
  });

  it("accepts a strong colour a trade might genuinely own", () => {
    expect(brandColorReadableAsText("#8B0000")).toBe(true); // dark red
    expect(brandColorReadableAsText("#1F3A93")).toBe(true); // navy
  });

  it("refuses an unset or unreadable colour rather than passing it through", () => {
    expect(brandColorReadableAsText(null)).toBe(false);
    expect(brandColorReadableAsText(undefined)).toBe(false);
    expect(brandColorReadableAsText("")).toBe(false);
    expect(brandColorReadableAsText("chartreuse")).toBe(false);
  });

  it("uses the body-text floor, not the softer large-text one", () => {
    // The headings this guards are large, so 3:1 would be defensible. 4.5 is
    // chosen because paper is the stricter case than a backlit screen and the
    // customer's printed copy is the one they keep.
    expect(BRAND_TEXT_MIN_CONTRAST).toBe(4.5);
  });
});

describe("the fill role is untouched, because it cannot fail", () => {
  it("still picks legible initials against any fill, pale yellow included", () => {
    // A monogram takes the raw brand colour as its background and chooses the
    // initials to suit. Routing this through the text guard would be wrong: it
    // would fall back to ink on a fill that is perfectly fine.
    expect(getContrastingTextColor(PALE_YELLOW)).toBe("#000000");
    expect(getContrastingTextColor(MOTKO_GREEN)).toBe("#FFFFFF");
  });
});

describe("what the renderers actually do with it", () => {
  it("paints the PDF company name in ink when the brand colour would vanish", async () => {
    const { PdfHeader } = await import("@/lib/pdf/shared");
    const header = PdfHeader({
      kind: "Quote",
      companyName: "Buckland Electrical Ltd",
      brandColor: PALE_YELLOW,
      reference: "ABCD1234",
      date: "14 March 2026",
    });

    // Walk the returned element tree for the company-name Text and read the
    // colour actually handed to the renderer. Asserting the rendered tree
    // rather than the source text: the claim is about what gets painted.
    const found = findStyleFor(header, "Buckland Electrical Ltd");
    expect(found, "the company name was not found in the header tree").not.toBeNull();
    expect(found).not.toBe(PALE_YELLOW);
    expect(brandColorReadableAsText(found ?? "")).toBe(true);
  });

  it("keeps the brand colour when it is readable", async () => {
    const { PdfHeader } = await import("@/lib/pdf/shared");
    const header = PdfHeader({
      kind: "Quote",
      companyName: "Buckland Electrical Ltd",
      brandColor: MOTKO_GREEN,
      reference: "ABCD1234",
      date: "14 March 2026",
    });

    expect(findStyleFor(header, "Buckland Electrical Ltd")).toBe(MOTKO_GREEN);
  });

  it("leaves the accent bar taking the raw colour, whatever it is", async () => {
    const { PdfAccentBar } = await import("@/lib/pdf/shared");
    // A 3pt rule carries no text. A pale one reads as an unbranded document
    // rather than a broken one — a degradation, not a failure — and darkening
    // a trade's livery to make a decorative bar louder buys no legibility.
    const bar = PdfAccentBar({ brandColor: PALE_YELLOW }) as ElementLike;
    const style = bar.props?.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect((flat as { backgroundColor?: string })?.backgroundColor).toBe(PALE_YELLOW);
  });
});

// --- tree walking -----------------------------------------------------------
// @react-pdf/renderer elements are ordinary React elements, so the returned
// tree can be walked without a renderer.

type ElementLike = {
  props?: {
    style?: unknown;
    children?: unknown;
  };
};

const flatColor = (style: unknown): string | null => {
  const merged = Array.isArray(style) ? Object.assign({}, ...style) : style;
  const color = (merged as { color?: unknown })?.color;
  return typeof color === "string" ? color : null;
};

const findStyleFor = (node: unknown, text: string): string | null => {
  if (node == null || typeof node !== "object") return null;
  const el = node as ElementLike;
  const children = el.props?.children;
  if (children === text) return flatColor(el.props?.style);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const hit = findStyleFor(child, text);
    if (hit != null) return hit;
  }
  return null;
};
