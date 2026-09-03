import { describe, it, expect } from "vitest";
import { extractSchemaReferences } from "../../scripts/ci/schema-probe";

// The probe extracts object keys as `(\w+)\s*:` over the body of an
// `.insert({…})` / `.update({…})` call. A comment inside that body is part of
// the match, and this repository's house style puts long explanations exactly
// there — so any sentence containing a colon became a column name.
//
// PR #532 was blocked by "Column 'inherited' referenced in
// src/app/jobs/actions.ts does not exist in production table 'contractors'".
// No such column exists and nothing referenced one; the comment read
// "…never / inherited: the stated-price reconciliation as before…".
//
// Seventh check found reporting a violation that cannot occur.
//
// Fixtures deliberately name `probe_fixture_table` rather than a real table:
// the probe scans `tests/` as well as `src/`, so example snippets naming
// `contractors` are themselves checked against production — which is exactly
// how the first version of this file turned into two false positives of its
// own.

describe("schema-probe ignores prose in comments", () => {
  it("does not read a word before a colon in a line comment as a column", () => {
    const { columns } = extractSchemaReferences(
      `
      await supabase
        .from("probe_fixture_table")
        .update({
          // Both flag families are recomputed from the lines being written,
          // never inherited: the stated-price reconciliation as before.
          day_rate: 250,
        });
      `,
      "example.ts",
    );

    expect(columns).toContain("day_rate");
    expect(columns).not.toContain("inherited");
  });

  it("does the same for a block comment", () => {
    const { columns } = extractSchemaReferences(
      `
      await supabase.from("probe_fixture_table").update({
        /* Note: the transcript is persisted here. Caveat: it carries PII. */
        transcript: text,
      });
      `,
      "example.ts",
    );

    expect(columns).toEqual(["transcript"]);
  });

  it("does not lose a real column that sits beside a comment", () => {
    const { columns, tables } = extractSchemaReferences(
      `
      await supabase.from("probe_fixture_table").update({
        // Recomputed, never carried forward.
        line_items_json: items,
        total, // shorthand
        contractor_flags_json: flags,
      });
      `,
      "example.ts",
    );

    expect(tables).toContain("probe_fixture_table");
    expect(columns).toContain("line_items_json");
    expect(columns).toContain("contractor_flags_json");
    expect(columns).not.toContain("Recomputed");
  });

  it("still reads columns out of a select, and still ignores a comment above it", () => {
    const { columns } = extractSchemaReferences(
      `
      // Careful: half_day_rate was previously unreachable from Business.
      const { data } = await supabase
        .from("probe_fixture_table")
        .select("id, day_rate, half_day_rate");
      `,
      "example.ts",
    );

    expect(columns).toEqual(expect.arrayContaining(["id", "day_rate", "half_day_rate"]));
    expect(columns).not.toContain("Careful");
  });

  it("does not mistake a URL's scheme for a comment", () => {
    // `https://…` contains `//`, so a naive strip would eat the rest of the
    // line and with it any column named after it.
    const { columns } = extractSchemaReferences(
      `
      await supabase.from("probe_fixture_table").update({
        logo_url: "https://example.com/logo.png",
        day_rate: 250,
      });
      `,
      "example.ts",
    );

    expect(columns).toContain("logo_url");
    expect(columns).toContain("day_rate");
    // The half this file was written for and originally failed to assert: the
    // URL's scheme is a word followed by a colon, so the key pattern read
    // `https` as a column. The test passed anyway because it only checked what
    // WAS found, never what was not — and CI then reported
    // "Column 'https' ... does not exist in production table 'contractors'".
    expect(columns).not.toContain("https");
  });
});
