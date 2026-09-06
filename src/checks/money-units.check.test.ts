import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Standing check: enforce that invoices.amount and quotes.total (both stored in
// POUNDS per migration 23) are never assigned to variables ending in "Pennies"
// without multiplying by 100. The defect on MONEY-1 was precisely this: treating
// a pounds value as pennies and dividing by 100 again, showing 1/100th of the
// correct amount.

const root = (p: string) => join(process.cwd(), p);

const walkDir = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

describe("Money unit discipline", () => {
  const srcFiles = walkDir(root("src"));

  it("invoices.amount is never assigned to a *Pennies variable without *100", () => {
    const violations: string[] = [];

    for (const file of srcFiles) {
      // Skip this check file itself to avoid self-reference
      if (file.endsWith("money-units.check.test.ts")) continue;

      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match variable declarations ending in "Pennies" assigned from invoice(s).amount
        const assignmentMatch = /(?:const|let|var)\s+(\w+Pennies)\s*=\s*[^;]*\binvoice[s]?\.amount\b/i.exec(line);
        if (assignmentMatch) {
          // Check if this assignment includes * 100 or Math.round(...* 100)
          const restOfLine = line.slice(assignmentMatch.index);
          if (!/\*\s*100/.test(restOfLine)) {
            violations.push(
              `${file}:${i + 1} assigns invoice(s).amount to ${assignmentMatch[1]} without * 100`,
            );
          }
        }
      }
    }

    expect(
      violations,
      `invoices.amount is in POUNDS (migration 23). A variable ending in "Pennies" ` +
        `must multiply by 100, or the name is wrong.`,
    ).toEqual([]);
  });

  it("quotes.total is never assigned to a *Pennies variable without *100", () => {
    const violations: string[] = [];

    for (const file of srcFiles) {
      // Skip this check file itself to avoid self-reference
      if (file.endsWith("money-units.check.test.ts")) continue;

      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match variable declarations ending in "Pennies" assigned from quote(s).total
        const assignmentMatch = /(?:const|let|var)\s+(\w+Pennies)\s*=\s*[^;]*\bquote[s]?\.total\b/i.exec(line);
        if (assignmentMatch) {
          const restOfLine = line.slice(assignmentMatch.index);
          if (!/\*\s*100/.test(restOfLine)) {
            violations.push(
              `${file}:${i + 1} assigns quote(s).total to ${assignmentMatch[1]} without * 100`,
            );
          }
        }
      }
    }

    expect(
      violations,
      `quotes.total is in POUNDS (per the formatGBP comment). A variable ending in ` +
        `"Pennies" must multiply by 100, or the name is wrong.`,
    ).toEqual([]);
  });
});
