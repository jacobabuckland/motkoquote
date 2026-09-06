import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("FACT-1: block comment attribution uses diagnostics, not mentions", () => {
  const engineer = readFileSync(
    join(process.cwd(), ".github/workflows/factory-engineer.yml"),
    "utf8",
  );

  it("the catch-all handler calls attribute-failure.sh, not grep", () => {
    // The CI gate handler already uses attribute-failure.sh correctly; this
    // asserts the catch-all does too.
    const catchall = engineer.split("Mark blocked on failure")[1];
    expect(catchall, "catch-all must exist").toBeDefined();

    // The attributor must be called from the catch-all section
    expect(
      catchall,
      "catch-all must use attribute-failure.sh to determine failing files",
    ).toContain("/tmp/attribute-failure.sh");
  });

  it("the catch-all does NOT grep the log for frozen paths directly", () => {
    // This is the pattern that caused the bug: a simple grep finding any mention
    // of a frozen path, rather than using the attributor to find only those
    // identified by diagnostics.
    const catchall = engineer.split("Mark blocked on failure")[1];

    expect(
      catchall,
      "catch-all must NOT grep for frozen paths — that finds mentions, not failures",
    ).not.toMatch(/grep.*tests\/acceptance/);

    expect(
      catchall,
      "catch-all must NOT grep for frozen paths — that finds mentions, not failures",
    ).not.toMatch(/grep.*docs\/specs/);
  });

  it("the frozen-file block depends on attributed failures, not bare mentions", () => {
    // The block saying "names files the Engineer may not edit" should only
    // appear when the attributor reports frozen=<path>, meaning a diagnostic
    // identified that path as failing.
    const catchall = engineer.split("Mark blocked on failure")[1];

    // The section that prints "names files the Engineer may not edit"
    const frozenBlock = catchall.match(
      /if \[.*?\]; then[\s\S]*?names files the Engineer may not edit[\s\S]*?fi/,
    );

    expect(frozenBlock, "frozen-file block must exist").not.toBeNull();
    if (!frozenBlock) return;

    // The condition guarding that block should check the attributor's output
    const condition = frozenBlock[0].match(/if \[(.*?)\]; then/)?.[1];
    expect(
      condition,
      "frozen-file block condition must check for attributed frozen files, not just any FROZEN variable",
    ).toBeTruthy();

    // Should reference frozen files from attribution, not from a simple grep
    expect(
      condition,
      "condition should check attributed frozen files from attribute-failure.sh output",
    ).toContain("FROZEN");
  });

  it("the could-not-be-attributed path exists for logs with no diagnostic", () => {
    // When attribute-failure.sh finds nothing (unidentified), the block should
    // say so rather than naming a file.
    const catchall = engineer.split("Mark blocked on failure")[1];

    expect(
      catchall,
      'must have a path for "could not be attributed to a file"',
    ).toContain("could not be attributed");
  });

  it("the amend-or-re-derive options appear only when a frozen file is attributed", () => {
    // The DECISION NEEDED section offering those two options is only valid when
    // a frozen path actually failed, not when one merely appeared in the log.
    const catchall = engineer.split("Mark blocked on failure")[1];

    // Find the frozen-file block
    const frozenMatch = catchall.match(
      /if \[.*?FROZEN.*?\]; then[\s\S]*?(amend the fix into the branch's FIRST commit|re-derive the item)[\s\S]*?fi/,
    );

    expect(
      frozenMatch,
      "the amend-or-re-derive options must be inside the frozen-file conditional block",
    ).not.toBeNull();
  });

  it("the CI gate handler already uses attribute-failure.sh correctly", () => {
    // This is unchanged; asserting it documents that the fix brings the
    // catch-all up to the same standard the gate already meets.
    const gateHandler = engineer.split("Require a green CI gate")[1];
    expect(gateHandler).toContain("/tmp/attribute-failure.sh");
    expect(gateHandler).toContain("ATTRIBUTION");
    expect(gateHandler).toContain("FROZEN_HITS");
  });

  it("both handlers parse attribution output the same way", () => {
    // attribute-failure.sh emits "frozen=<path>" for attributed frozen files.
    // Both the gate handler and the catch-all should parse this output
    // consistently.

    // Gate handler extracts frozen hits
    const gateHandler = engineer.split("Require a green CI gate")[1];
    const gateExtract = gateHandler.match(/FROZEN_HITS=\$\(([\s\S]*?)\)/)?.[1];
    expect(gateExtract, "gate handler must extract frozen hits").toBeTruthy();
    expect(gateExtract).toContain("sed -n 's/^frozen=//p'");

    // Catch-all should use the same approach
    const catchall = engineer.split("Mark blocked on failure")[1];
    const catchallExtract = catchall.match(/FROZEN[\s\S]*?=\$\(([\s\S]*?)\)/)?.[1];
    expect(catchallExtract, "catch-all must extract frozen hits").toBeTruthy();
    expect(
      catchallExtract,
      "catch-all must parse attribute-failure.sh output, not grep the log",
    ).toContain("attribute-failure.sh");
  });
});
