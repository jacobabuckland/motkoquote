import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A pending control loses its label COLOUR, never its CONTRAST.
 *
 * `disabled:opacity-50` does the opposite of what it looks like it does. It
 * composites the fill AND the label toward whatever sits behind them, so both
 * ends of the pair move together and the ratio between them collapses.
 * Measured on --ground, this is what every disabled control in the product
 * scored before 11 Sep 2026:
 *
 *   primary   (bg-green / white)  2.90:1
 *   secondary (bg-card  / ink)    3.12:1
 *   tertiary  (no fill  / ink-2)  2.27:1
 *
 * All three fail WCAG AA. DEFECTS #15 named only the first, because the first
 * is the one a screenshot caught — the sign-in button, unreadable for the whole
 * time it says "Signing in...". But it was a single declaration on the shared
 * `base` string in button.tsx, so it was always one defect wearing three faces,
 * plus seven more on hand-rolled buttons that never used the component.
 *
 * The replacement is the muted pair at 7.54:1 for filled controls, and
 * --ink-muted at 4.77:1 for text links, which dims without dropping below the
 * palette's documented floor.
 *
 * WHY A SOURCE CHECK. happy-dom resolves neither custom properties nor
 * Tailwind's generated CSS, so rendering a disabled button and reading its
 * computed colour returns nothing usable. The property worth pinning is that
 * no control dims itself by compositing — a fact about the file. The two
 * sibling walkers in this directory read source for the same reason.
 */

const SRC = resolve(__dirname, "../../src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx$/.test(entry)) out.push(relative(SRC, full));
  }
  return out;
};

/** Strip comments so the explanatory note in button.tsx is not an offender. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const files = walk(SRC);

describe("pending controls keep their contrast", () => {
  it("finds the components to check", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("components/ui/button.tsx");
  });

  it("no control dims itself with disabled:opacity", () => {
    const offenders = files.filter((file) =>
      /disabled:opacity-/.test(codeOnly(readFileSync(join(SRC, file), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the shared Button declares the pending pair instead", () => {
    const source = readFileSync(join(SRC, "components/ui/button.tsx"), "utf8");
    expect(source).toContain("disabled:bg-muted-fill");
    expect(source).toContain("disabled:text-muted-ink");
  });

  it("the pending pair is defined and is the one the Button reaches for", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    // Both halves must exist as tokens; a utility with no token behind it
    // emits no rule at all, which is how --color-muted-foreground was lost
    // once before (see the note at that token).
    expect(css).toMatch(/--muted-fill:\s*#c3cec6/);
    expect(css).toMatch(/--muted-ink:\s*#2c3832/);
    expect(css).toContain("--color-muted-fill: var(--muted-fill)");
    expect(css).toContain("--color-muted-ink: var(--muted-ink)");
  });
});
