import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

// A Tailwind colour utility whose theme key is not exported emits NO rule at
// all. Nothing fails: the class stays in the markup, the build passes, the type
// checker is happy, and the element quietly renders in whatever it inherited.
//
// That is how `text-muted-foreground` sat on the job P&L panel and the cost list
// through twelve usages — the labels rendered in full-strength ink instead of
// muted grey and the card lost its hierarchy, on a screen nobody had reason to
// re-measure. This test is the thing that would have caught it.

const THEME_BLOCK = (() => {
  const css = readFileSync("src/app/globals.css", "utf8");
  return css.slice(css.indexOf("@theme inline"), css.indexOf("@layer base"));
})();

const exportedColours = new Set(
  [...THEME_BLOCK.matchAll(/^\s*--color-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

// Tailwind's default palette stays available — nothing here removes it.
const DEFAULT_HUES = new Set([
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
  "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
  "indigo", "violet", "purple", "fuchsia", "pink", "rose",
]);
const DEFAULT_SHADES = new Set([
  "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950",
]);
const KEYWORDS = new Set(["white", "black", "transparent", "current", "inherit"]);

// Prefixes whose argument is a colour. `text-` is deliberately absent: it is
// ambiguous with the font-size scale, so it is handled separately below.
const COLOUR_PREFIXES = ["bg", "border", "ring", "fill", "stroke", "divide", "outline", "accent", "caret", "placeholder", "decoration", "from", "via", "to"];

const FONT_SIZES = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
const TEXT_KEYWORDS = new Set(["left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip"]);

const resolvesAsColour = (name: string): boolean => {
  if (KEYWORDS.has(name) || exportedColours.has(name)) return true;
  const parts = name.split("-");
  const shade = parts[parts.length - 1]!;
  return DEFAULT_HUES.has(parts.slice(0, -1).join("-")) && DEFAULT_SHADES.has(shade);
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });

// Every whitespace-delimited token inside a className/class string.
const classTokens = (source: string): string[] => {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    for (const raw of value.split(/\s+/)) if (raw) out.push(raw);
  }
  // Class strings held in a const, e.g. the pipeline stepper's state maps.
  for (const m of source.matchAll(/"((?:[a-z0-9:/[\]().,%#-]+ )+[a-z0-9:/[\]().,%#-]+)"/g)) {
    for (const raw of m[1]!.split(/\s+/)) if (raw) out.push(raw);
  }
  return out;
};

describe("every colour utility used in src resolves to a real token", () => {
  const unresolved: string[] = [];

  for (const file of sourceFiles("src")) {
    for (const token of classTokens(readFileSync(file, "utf8"))) {
      // Strip variant prefixes (hover:, sm:, dark:) and the opacity modifier.
      const bare = token.replace(/^(?:[a-z0-9-]+:)+/, "").replace(/^!/, "").split("/")[0]!;
      if (bare.includes("[")) continue; // arbitrary value — always resolves
      // The const-string sweep is deliberately loose, so it picks up fragments
      // that are not class names at all. A real utility is lowercase, digits
      // and dashes — anything else is the scanner's own noise, not a finding.
      if (!/^[a-z][a-z0-9-]*$/.test(bare)) continue;

      const dash = bare.indexOf("-");
      if (dash < 0) continue;
      const prefix = bare.slice(0, dash);
      const rest = bare.slice(dash + 1);

      if (prefix === "text") {
        if (FONT_SIZES.has(rest) || TEXT_KEYWORDS.has(rest)) continue;
        if (!resolvesAsColour(rest)) unresolved.push(`${bare}  (${file})`);
        continue;
      }
      if (!COLOUR_PREFIXES.includes(prefix)) continue;
      // Non-colour arguments these prefixes also take: widths, styles, sides.
      if (/^\d/.test(rest)) continue;
      if (/^(solid|dashed|dotted|double|hidden|none|collapse|separate|spacing|offset|underline|overline|line-through|wavy|auto|from-font)/.test(rest)) continue;
      if (prefix === "border" && /^[xytblrse](-|$)/.test(rest)) {
        const side = rest.replace(/^[a-z]{1,2}-?/, "");
        if (!side || /^\d/.test(side) || resolvesAsColour(side)) continue;
      }
      if (prefix === "divide" && /^[xy](-|$)/.test(rest)) continue;
      if (prefix === "bg" && /^(cover|contain|center|top|bottom|left|right|repeat|no-repeat|fixed|local|scroll|clip|origin|gradient|linear|radial|conic)/.test(rest)) continue;

      if (!resolvesAsColour(rest)) unresolved.push(`${bare}  (${file})`);
    }
  }

  it("exports --color-muted-foreground, which twelve usages depend on", () => {
    expect(exportedColours.has("muted-foreground")).toBe(true);
  });

  it("leaves no colour utility pointing at an unexported theme key", () => {
    expect([...new Set(unresolved)].sort()).toEqual([]);
  });
});
