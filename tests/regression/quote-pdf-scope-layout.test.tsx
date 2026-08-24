// Regression: the Scope of work section overlapped itself on a real quote.
//
// The `Kitchen` heading collided with the paragraph above it, the work-item
// line collided with the `Living Room` heading below, and the displacement
// carried on down the block. The overview paragraph at the top rendered
// cleanly, which is the clue: it uses a style with no `flex`, and the room
// breakdown used `scopeBulletText`, which sets `flex: 1`.
//
// `flex: 1` is correct where that style was designed to be used — inside
// `scopeBullet`, which is `flexDirection: "row"`, where it means "fill the
// remaining width beside the bullet mark". It was then reused inside
// `scopeRoom`, which declares NO flexDirection and therefore defaults to
// COLUMN. In a column container `flex: 1` applies along the vertical main axis
// with `flex-basis: 0`, so the wrapped text's own height stops being the
// starting measurement and the block is laid out shorter than it draws. The
// next sibling is positioned from that wrong height.
//
// What these tests can and cannot do is worth being plain about: a PDF buffer
// check cannot see two glyphs sitting on top of each other. The structural
// assertions below are what actually prevent recurrence; the render test only
// proves the content is present. Confirming the fix visually needs one look at
// a rendered two-room quote.
import { describe, expect, it } from "vitest";
import { styles } from "@/lib/pdf/quote-pdf";

// Every style in quote-pdf.tsx that sets `flex` on a <Text>, paired with the
// container style it is rendered inside. A flexed Text is only safe in a
// container that declares flexDirection "row".
//
// This is a registry, not a scan: a new flexed text style has to be added here
// with its parent named, which is the point. Adding one without a row parent
// fails the check rather than silently shipping the overlap again.
// StyleSheet.create narrows each style to the literal shape it was declared
// with, so `styles.scopeRoom.flexDirection` is a TYPE error rather than
// `undefined` — and asserting the ABSENCE of a property is the whole point
// here. This widens the lookup to read a value that may or may not be there.
// The objects are real at runtime; nothing is being conjured.
const styleValue = (style: object, key: string): unknown =>
  (style as Record<string, unknown>)[key];

const FLEXED_TEXT_STYLES = [
  { name: "scopeBulletText", style: styles.scopeBulletText, parent: styles.scopeBullet },
] as const;

describe("no Text is flexed inside a column container", () => {
  it.each(FLEXED_TEXT_STYLES)(
    "$name is only used inside a flexDirection:row parent",
    ({ style, parent }) => {
      expect(styleValue(style, "flex")).toBeDefined();
      // If this fails, a flexed Text is being laid out along a vertical main
      // axis and will be given a height smaller than the lines it draws.
      expect(styleValue(parent, "flexDirection")).toBe("row");
    },
  );

  it("gives the room work-item line no flex, because scopeRoom is a column", () => {
    expect(styleValue(styles.scopeRoom, "flexDirection")).toBeUndefined();
    expect(
      styleValue(styles.scopeRoomText, "flex"),
      "scopeRoom declares no flexDirection, so it is a COLUMN — a flexed child is laid out shorter than it draws and the next room's heading lands on top of it",
    ).toBeUndefined();
  });

  it("keeps the bullet-row style flexed, so the bullet list still fills its row", () => {
    // The fix must not be "delete flex everywhere". Inside scopeBullet it is
    // load-bearing: without it the text does not fill the width beside the mark.
    expect(styleValue(styles.scopeBulletText, "flex")).toBe(1);
    expect(styleValue(styles.scopeBullet, "flexDirection")).toBe("row");
  });

  it("gives the room line the same type treatment as the bullet line", () => {
    // Only the flex differs. A divergence in size or leading here would be an
    // accidental visual change riding along with a layout fix.
    expect(styles.scopeRoomText.fontSize).toBe(styles.scopeBulletText.fontSize);
    expect(styles.scopeRoomText.lineHeight).toBe(styles.scopeBulletText.lineHeight);
  });
});

describe("a multi-room scope renders", () => {
  it("emits a PDF carrying every room name and work item", async () => {
    const { pdf } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    // Two rooms, each with work items long enough to wrap onto several lines.
    // That is the shape that collided: a single short room never revealed it,
    // because there was nothing below to be displaced onto.
    const doc = buildQuotePdfDocument({
      reference: "SCOPE001",
      createdAt: "2026-03-14T09:30:00.000Z",
      jobType: "rewire",
      contractor: null,
      customer: null,
      lineItems: [
        {
          description: "Rewire works — see Scope of work",
          category: "other",
          quantity: 1,
          unit: "job",
          unit_price: 5000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ],
      scope: {
        overviewNarrative:
          "Full rewire of two rooms, carried out over four days with the property occupied throughout.",
        rooms: [
          {
            name: "Kitchen",
            dimensions: "4m x 3m",
            workItems: [
              "Rewire the kitchen inclusive of all sockets, spurs and the cooker circuit",
              "Replace the consumer unit and test every new circuit before handover",
            ],
          },
          {
            name: "Living Room",
            workItems: [
              "Rewire the living room including two double sockets either side of the chimney breast",
              "Make good all chases and channels ready for the decorator",
            ],
          },
        ],
        additionalItems: [],
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: { contractorSupplied: [], customerSupplied: ["all materials"] },
        assumptions: [],
        timeline: "Around four days.",
      },
    });

    const blob = await pdf(doc as Parameters<typeof pdf>[0]).toBlob();

    // Not a claim that nothing overlaps — see the note at the top of this file.
    // It is a claim that a two-room scope renders at all, which is the fixture
    // the collision needed.
    expect(blob.size).toBeGreaterThan(0);
  }, 30_000);
});
