import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import exampleResult from "../../harness/results/example-result.json";
import {
  RUN_AND_WRITE_COMMAND,
  runAndWrite,
} from "../../harness/run-and-write";
import { parseNextFix } from "../../harness/write-result";

const here = dirname(fileURLToPath(import.meta.url));
const repoHarness = join(here, "../../harness");
const schemaPath = join(repoHarness, "harness-result.schema.json");

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seedHarness(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-run-and-write-"));
  tempRoots.push(dir);
  mkdirSync(join(dir, "results", "archive"), { recursive: true });
  copyFileSync(schemaPath, join(dir, "harness-result.schema.json"));
  writeFileSync(
    join(dir, "NEXT_FIX.md"),
    readFileSync(join(repoHarness, "NEXT_FIX.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "RETEST_PROMPT.md"),
    readFileSync(join(repoHarness, "RETEST_PROMPT.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "BACKLOG.md"),
    readFileSync(join(repoHarness, "BACKLOG.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "LESSONS.md"),
    readFileSync(join(repoHarness, "LESSONS.md"), "utf8"),
    "utf8",
  );
  return dir;
}

describe("runAndWrite", () => {
  it("invokes the writer so a scored JSON updates results and NEXT_FIX", async () => {
    const root = seedHarness();
    const input = join(root, "scored.json");
    writeFileSync(input, `${JSON.stringify(exampleResult, null, 2)}\n`, "utf8");

    const code = await runAndWrite(["--harness-root", root, input]);

    expect(code).toBe(0);
    expect(existsSync(join(root, "results", `${exampleResult.runId}.json`))).toBe(
      true,
    );
    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("open");
    expect(nextFix.caseId).toBe("quote-rewire-three-bed");
  });

  it("does not write when the payload is invalid JSON", async () => {
    const root = seedHarness();
    const input = join(root, "broken.json");
    writeFileSync(input, "{not-json\n", "utf8");
    const before = readFileSync(join(root, "NEXT_FIX.md"), "utf8");

    const code = await runAndWrite(["--harness-root", root, input]);

    expect(code).toBe(1);
    expect(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).toBe(before);
    expect(existsSync(join(root, "results", `${exampleResult.runId}.json`))).toBe(
      false,
    );
  });
});

describe("GPT standing orders", () => {
  it("name run-and-write as the required last step", () => {
    const md = readFileSync(join(repoHarness, "GPT_HARNESS.md"), "utf8");
    expect(md).toContain(RUN_AND_WRITE_COMMAND);
    expect(md).toMatch(/Mandatory last step/i);
    expect(md.indexOf("Mandatory last step")).toBeLessThan(
      md.indexOf("Before you speak"),
    );
  });
});
