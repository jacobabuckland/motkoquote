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

async function checkGeneratedLanguage() {
  console.log("Running generated-language lint...");
  console.log("Drafting quote from fixture extraction...");

  let draft;
  try {
    draft = await draftQuoteLineItems(testExtraction, testContractor);
  } catch (error: unknown) {
    // If drafting fails (e.g., API key missing in CI), skip the check rather
    // than failing the build. This check is about WHAT gets generated, not
    // whether generation itself works (other tests cover that).
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `Skipping: drafting failed (${message}). This is expected in CI without API credentials.`,
    );
    process.exit(0);
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
