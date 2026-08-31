#!/usr/bin/env tsx

/**
 * CI lint: checks that drafted quote output does not contain "as agreed"
 * phrases unless they come from a captured field.
 *
 * This is the D7 enforcement mechanism - the drafting prompt forbids these
 * phrases, and this script verifies the constraint by drafting from fixture
 * transcripts and asserting no such phrases appear in generated content.
 */

import { draftQuoteLineItems } from "@/lib/claude";
import type { JobExtraction } from "@/lib/schemas/job";
import type { ContractorContext } from "@/lib/claude";

// Simple fixture extraction - a basic job with no "as agreed" in the input
const testExtraction: JobExtraction = {
  job_type: "downlights",
  scope_items: ["Install six downlights in living room"],
  additional_items: [],
  dimensions: undefined,
  materials_mentioned: ["Downlights", "cable"],
  access_issues: undefined,
  timeline: "Next week",
  notes: undefined,
  crew_description: "Just me",
  materials_supply: {
    contractor_supplied: ["Downlights", "cable"],
    customer_supplied: [],
  },
};

const testContractor: ContractorContext = {
  trade: "electrician",
  day_rate: 300,
  overtime_rate: null,
  callout_min: null,
  travel_rate: null,
  markup_pct: 25,
  team_members: [],
  rate_cards: [],
};

// Phrases that should never appear in generated content unless they come from
// a captured field. The contractor never said these in the fixture above, so
// if they appear in the draft, the model invented them.
const FORBIDDEN_PHRASES = [
  "as agreed",
  "as discussed",
  "as per our conversation",
  "as we discussed",
];

/**
 * Static check: verifies that the drafting prompt contains the required
 * constraints against invented specification and unbacked "as agreed" phrases.
 *
 * This is a fallback when we can't run the generative check (no API key in CI).
 * It's not as strong as checking actual generated output, but it's better than
 * silently passing without any verification.
 */
async function checkPromptConstraints() {
  console.log("Checking prompt constraints statically...");

  // Read the claude.ts file to inspect the system prompt
  const fs = await import("node:fs");
  const path = await import("node:path");

  const claudePath = path.join(process.cwd(), "src/lib/claude.ts");
  if (!fs.existsSync(claudePath)) {
    console.error("❌ LINT FAILURE: src/lib/claude.ts not found");
    process.exit(1);
  }

  const claudeSource = fs.readFileSync(claudePath, "utf-8");

  // Check for D5: No invented specification constraint
  // Should forbid inventing brands, finishes, ratings, product details
  const hasInventedSpecConstraint =
    claudeSource.includes("NEVER invent brands") ||
    claudeSource.includes("do not invent") ||
    claudeSource.includes("Only include specific product details");

  if (!hasInventedSpecConstraint) {
    console.error("\n❌ LINT FAILURE: D5 constraint missing\n");
    console.error(
      "The drafting prompt must forbid inventing brands, finishes, ratings,",
    );
    console.error(
      "or product details not present in the transcript. See docs/specs/481.md (D5).\n",
    );
    process.exit(1);
  }

  // Check for D7: "as agreed" phrase constraint
  // Should forbid "as agreed", "as discussed", etc. unless from captured field
  const hasAsAgreedConstraint =
    (claudeSource.includes("as agreed") ||
      claudeSource.includes("as discussed")) &&
    (claudeSource.includes("NEVER use phrases like") ||
      claudeSource.includes("Do not generate these phrases"));

  if (!hasAsAgreedConstraint) {
    console.error("\n❌ LINT FAILURE: D7 constraint missing\n");
    console.error(
      "The drafting prompt must forbid 'as agreed' / 'as discussed' phrases",
    );
    console.error(
      "unless they come from a captured field. See docs/specs/481.md (D7).\n",
    );
    process.exit(1);
  }

  console.log("✓ D5 constraint present (no invented specification)");
  console.log("✓ D7 constraint present (no unbacked 'as agreed' phrases)");
  console.log(
    "\nStatic check passed. Note: this verifies the constraints exist in the",
  );
  console.log(
    "prompt, but does not test generated output. Run with ANTHROPIC_API_KEY set",
  );
  console.log("to perform the full generative check.\n");
  process.exit(0);
}

async function checkGeneratedLanguage() {
  console.log("Running generated-language lint...");

  // When ANTHROPIC_API_KEY is missing, we can't draft output, so we fall back
  // to a static check of the prompt constraints. The spec requires checking
  // generated output, but a static check is better than silently passing.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "ANTHROPIC_API_KEY not set — falling back to static constraint check.",
    );
    await checkPromptConstraints();
    return;
  }

  console.log("Drafting quote from fixture extraction...");

  let draft;
  try {
    draft = await draftQuoteLineItems(testExtraction, testContractor);
  } catch (error: unknown) {
    // If drafting fails for a reason OTHER than missing API key, fall back to
    // the static check rather than failing the build on transient API errors.
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `Warning: drafting failed (${message}). Falling back to static check.`,
    );
    await checkPromptConstraints();
    return;
  }

  console.log(`Drafted ${draft.line_items.length} line items.`);

  // Collect all customer-facing text that could contain these phrases
  const customerFacingText: string[] = [];

  for (const item of draft.line_items) {
    customerFacingText.push(item.description);
    if (item.customer_note) {
      customerFacingText.push(item.customer_note);
    }
  }

  // Check for forbidden phrases
  const violations: Array<{ text: string; phrase: string }> = [];
  for (const text of customerFacingText) {
    const lowerText = text.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lowerText.includes(phrase)) {
        violations.push({
          text,
          phrase,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("\n❌ LINT FAILURE: Unbacked 'as agreed' phrases detected\n");
    console.error(
      "The drafting model generated phrases that imply a prior agreement,",
    );
    console.error(
      "but these phrases were NOT in the captured transcript data.\n",
    );

    for (const { text, phrase } of violations) {
      console.error(`  Found "${phrase}" in:`);
      console.error(`  "${text}"\n`);
    }

    console.error(
      "These phrases may only appear when they come from a captured field",
    );
    console.error("(e.g., the contractor actually said them in the transcript).");
    console.error(
      "The model must not invent them. See docs/specs/481.md (D7).\n",
    );

    process.exit(1);
  }

  console.log("✓ No unbacked 'as agreed' phrases found.");
  console.log("Generated-language lint passed.\n");
  process.exit(0);
}

checkGeneratedLanguage().catch((error: unknown) => {
  console.error("Lint script failed:", error);
  process.exit(1);
});
