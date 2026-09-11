import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * No component names a colour the token layer doesn't own.
 *
 * The rule is "no OFF-TOKEN colour", not "no raw hex". Hex was never the whole
 * problem: this tree had 31 hex literals and 39 default-Tailwind palette
 * classes (`bg-red-50`, `border-amber-800`, `text-gray-700`, `bg-stone-200`),
 * and a hex-only check waves every one of the 39 through. They are the same
 * defect — a colour decided at the call site, outside the system — and two of
 * them were carrying real contrast failures:
 *
 *   • `text-gray-700` on `bg-gray-400` (the muted mic control) — 4.06:1, below
 *     AA for body text.
 *   • `text-amber-900` on `bg-amber-50` had no token equivalent that passed:
 *     --amber on --amber-tint is 4.18:1, which is why --amber-ink exists.
 *
 * Two more forms are caught because they are the same decision wearing
 * different clothes: an arbitrary class (`shadow-[0_0_28px_rgba(0,66,37,0.45)]`
 * — that was --green at 45%, restated as a literal that could drift from it)
 * and a `dark:` variant (this product has no dark theme, but Tailwind v4 still
 * emits `dark:` under prefers-color-scheme, so `dark:bg-amber-950` fired on a
 * user's device and put near-black ink on a near-black panel).
 *
 * WHY THIS READS SOURCE. A class name is a fact about the file. happy-dom
 * resolves neither custom properties nor Tailwind's generated CSS, so a
 * computed-colour assertion would prove nothing, and most of these files are
 * server components. tests/regression/every-screen-carries-the-top-inset.test.ts
 * reads source for the same reason and set the precedent.
 */

const SRC = resolve(__dirname, "../../src");

/**
 * Files allowed to name a colour directly, each for a reason that is a
 * property of the file rather than a preference.
 *
 * THIS LIST MAY ONLY EVER SHRINK — same contract as the safe-area walker. A
 * new file does not get added to it; it gets a token.
 */
const EXEMPT: Record<string, string> = {
  // The token layer itself. Somebody has to hold the literals.
  "app/globals.css": "defines the tokens",

  // Computes a readable foreground for a contractor's OWN brand colour, which
  // is user data and unknowable at build time. #FFFFFF/#000000 here are the
  // two answers, not a palette.
  "lib/color-contrast.ts": "functional — computes contrast, does not style",

  // Mail clients do not resolve custom properties. An email that references
  // var(--ink) renders with no colour at all.
  "lib/email.ts": "email HTML — mail clients cannot read CSS variables",

  // STEP 5 DEBT, not an exemption on the merits. The PDF runs a separate navy
  // system (#111827/#6b7280/#e5e7eb/#f9fafb) and rebuilding it on the app's
  // tokens is its own step. When that lands, delete these three entries — they
  // are the only reason this list is longer than it should be.
  "lib/pdf/shared.tsx": "step 5 — separate navy system, rebuild pending",
  "lib/pdf/quote-pdf.tsx": "step 5 — brandColor default",
  "lib/pdf/sow-pdf.tsx": "step 5 — brandColor default",

  // BLOCKED, not exempt. `bg-stone-200` has no defence on the merits — it is
  // held in place by tests/acceptance/145.test.tsx:161-163, which asserts
  // `.animate-pulse.bg-stone-200` on the three customer-facing loading routes.
  // Acceptance tests are frozen and nothing downstream may repair one, so the
  // conversion to --card-hover waits on a card naming those three assertions
  // for retirement. The assertion's own name — "all three loading skeletons
  // use the Skeleton component" — says the class pair was standing in for
  // component identity, so retiring it costs the contract nothing.
  "components/ui/skeleton.tsx": "blocked by frozen tests/acceptance/145.test.tsx:161-163",
};

/**
 * `?? "#004225"` — the fallback when a contractor has set no brand colour.
 * This is a DATA default standing in for a column value, not a styling
 * decision, and it is the same green the token holds. Matched by shape so a
 * new call site is covered without being listed.
 */
const BRAND_COLOUR_FALLBACK = /brand_?[Cc]olor|themeColor/i;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(tsx?|css)$/.test(entry)) out.push(relative(SRC, full));
  }
  return out;
};

/** Strip comments and JSX text so a `#119` issue reference is never a colour. */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");

const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|decoration|accent|caret|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g;

const ARBITRARY_COLOUR = /\b(?:bg|text|border|ring|shadow|fill|stroke)-\[(?:#|rgba?\(|hsla?\()/g;

const HEX_LITERAL = /["'`][^"'`]*#[0-9a-fA-F]{6}\b/g;

const files = walk(SRC);

const offenders = (pattern: RegExp, skipExempt: boolean, extraSkip?: RegExp) => {
  const found: string[] = [];
  for (const file of files) {
    if (skipExempt && EXEMPT[file]) continue;
    const source = codeOnly(readFileSync(join(SRC, file), "utf8"));
    for (const line of source.split("\n")) {
      if (extraSkip?.test(line)) continue;
      const hits = line.match(new RegExp(pattern.source, "g"));
      if (hits) found.push(`${file}: ${hits.join(", ")}`);
    }
  }
  return found.sort();
};

describe("no off-token colour", () => {
  it("finds the files to check", () => {
    // Guards the walker: a refactor that moves src elsewhere would otherwise
    // make this whole file pass by checking nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app/globals.css");
    expect(files).toContain("components/ui/button.tsx");
  });

  it("names no default-Tailwind palette colour", () => {
    expect(offenders(PALETTE_CLASS, true)).toEqual([]);
  });

  it("names no colour in an arbitrary-value class", () => {
    expect(offenders(ARBITRARY_COLOUR, true)).toEqual([]);
  });

  it("names no hex literal outside the exempt files", () => {
    expect(offenders(HEX_LITERAL, true, BRAND_COLOUR_FALLBACK)).toEqual([]);
  });

  it("carries no dark: variant — this product has no dark theme", () => {
    // Tailwind v4 emits `dark:` under prefers-color-scheme with no opt-in, so
    // a stray one is live on a user's device against a palette that has no
    // dark values to pair with it.
    expect(offenders(/\bdark:/g, false)).toEqual([]);
  });

  it("the exempt list only shrinks — no new file may join it", () => {
    expect(Object.keys(EXEMPT).sort()).toEqual(
      [
        "app/globals.css",
        "components/ui/skeleton.tsx",
        "lib/color-contrast.ts",
        "lib/email.ts",
        "lib/pdf/quote-pdf.tsx",
        "lib/pdf/shared.tsx",
        "lib/pdf/sow-pdf.tsx",
      ].sort(),
    );
  });
});
