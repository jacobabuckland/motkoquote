import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  DRAFTING_MODEL,
  DRAFTING_TEMPERATURE,
  TRANSCRIPTION_MODEL,
  VOICE_MODEL,
} from "@/lib/models";

// V2: every model identifier the app sends lives in src/lib/models.ts, so a
// provider-side change is a one-file question rather than a repo-wide hunt.
//
// The point is not the values — it is that no call site carries its own bare
// literal. A model string inlined at a call site is how three identifiers went
// a month without anyone noticing they were unpinned.

const SRC = join(process.cwd(), "src");
const CONSTANTS_FILE = join(SRC, "lib", "models.ts");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.tsx?$/.test(full)
        ? [full]
        : [];
  });

describe("V2 — model identifiers are centralised", () => {
  it("has no bare model literal anywhere in src/ outside the constants module", () => {
    // Each alias, as it would appear inlined at a call site.
    const aliases = [VOICE_MODEL, TRANSCRIPTION_MODEL, DRAFTING_MODEL];

    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === CONSTANTS_FILE) continue;
      const source = readFileSync(file, "utf8");
      for (const alias of aliases) {
        // A quoted occurrence is an inlined identifier. An unquoted mention in
        // prose (a comment explaining the pin) is fine and is not matched.
        if (source.includes(`"${alias}"`) || source.includes(`'${alias}'`)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} → ${alias}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("sets an explicit temperature on the drafting call rather than inheriting one", () => {
    const source = readFileSync(join(SRC, "lib", "claude.ts"), "utf8");

    // Both calls — the narrative and the line-item draft.
    expect(source.match(/temperature: DRAFTING_TEMPERATURE/g)).toHaveLength(2);
    expect(typeof DRAFTING_TEMPERATURE).toBe("number");
  });

  it("carries a dated provenance comment for every identifier", () => {
    const constants = readFileSync(CONSTANTS_FILE, "utf8");

    // Each identifier's state must be recorded with a date, so "is this still
    // current?" has an answer without going to the provider.
    expect(constants).toMatch(/Checked 2026-\d{2}-\d{2}/);
    // And the un-pinned ones must say so in as many words, rather than being
    // quietly left as aliases.
    expect(constants).toMatch(/NOT PINNED/);
  });

  it("routes the realtime session through the constants", () => {
    const source = readFileSync(join(SRC, "lib", "realtime.ts"), "utf8");

    expect(source).toMatch(/model: VOICE_MODEL/);
    expect(source).toMatch(/model: TRANSCRIPTION_MODEL/);
  });
});
