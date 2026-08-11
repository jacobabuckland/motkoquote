import { describe, expect, it } from "vitest";

import {
  parseDatabases,
  schemaProblems,
} from "../../scripts/factory/poll-notion.mjs";

const ROADMAP = "3b71e4f908b4807faee0e8473df2a683";
const BUGS = "3b91e4f908b480f0b9fcce518dfa63b3";

// Loosely typed on purpose: these fixtures stand in for raw Notion API
// responses, and every negative case below works by deleting a property or
// swapping its type — exactly what a `Record` permits and a literal type does
// not.
type DatabaseFixture = {
  title: { plain_text: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
};

// A database that satisfies every requirement, used as the baseline the
// negative cases degrade from.
const validDatabase = (title = "Roadmap"): DatabaseFixture => ({
  title: [{ plain_text: title }],
  properties: {
    Name: { type: "title" },
    Status: {
      type: "select",
      select: {
        options: [
          { name: "Backlog" },
          { name: "Ready for factory" },
          { name: "In factory" },
          { name: "Previewed" },
          { name: "Shipped" },
          { name: "Blocked" },
          { name: "Needs spec" },
        ],
      },
    },
    Module: { type: "select", select: { options: [] } },
    "GitHub Issue": { type: "url" },
    "Preview URL": { type: "url" },
  },
});

describe("parseDatabases", () => {
  it("reads a single bare id, the pre-existing configuration", () => {
    expect(parseDatabases(ROADMAP)).toEqual([{ id: ROADMAP, label: null }]);
  });

  it("reads a comma-separated list, preserving order", () => {
    expect(parseDatabases(`${ROADMAP},${BUGS}`)).toEqual([
      { id: ROADMAP, label: null },
      { id: BUGS, label: null },
    ]);
  });

  it("reads a per-database label from an `id:label` entry", () => {
    expect(parseDatabases(`${ROADMAP}:enhancement,${BUGS}:bug`)).toEqual([
      { id: ROADMAP, label: "enhancement" },
      { id: BUGS, label: "bug" },
    ]);
  });

  it("tolerates whitespace around entries", () => {
    expect(parseDatabases(` ${ROADMAP} : enhancement , ${BUGS} `)).toEqual([
      { id: ROADMAP, label: "enhancement" },
      { id: BUGS, label: null },
    ]);
  });

  it("accepts the dashed form of an id", () => {
    const dashed = "3b71e4f9-08b4-807f-aee0-e8473df2a683";
    expect(parseDatabases(dashed)).toEqual([{ id: dashed, label: null }]);
  });

  it("rejects an empty value rather than polling nothing", () => {
    expect(() => parseDatabases("")).toThrow(/NOTION_DATABASE_ID is empty/);
    expect(() => parseDatabases(undefined)).toThrow(/NOTION_DATABASE_ID is empty/);
  });

  it("rejects a malformed id rather than silently skipping it", () => {
    expect(() => parseDatabases(`${ROADMAP},not-an-id`)).toThrow(
      /not a Notion database id/
    );
  });

  it("rejects a trailing colon with no label", () => {
    expect(() => parseDatabases(`${ROADMAP}:`)).toThrow(/trailing ":"/);
  });

  it("rejects a repeated database, which would double-issue every item", () => {
    expect(() => parseDatabases(`${ROADMAP},${ROADMAP}:bug`)).toThrow(
      /more than once/
    );
  });

  it("treats the dashed and undashed form of one id as the same database", () => {
    expect(() =>
      parseDatabases(`${ROADMAP},3b71e4f9-08b4-807f-aee0-e8473df2a683`)
    ).toThrow(/more than once/);
  });
});

describe("schemaProblems", () => {
  it("passes a database carrying everything the pipeline drives", () => {
    expect(schemaProblems(validDatabase())).toEqual([]);
  });

  it("names a case-mismatched property instead of just calling it missing", () => {
    const database = validDatabase("Bugs");
    database.properties["Github Issue"] = database.properties["GitHub Issue"];
    delete database.properties["GitHub Issue"];

    const problems = schemaProblems(database);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/"Github Issue"/);
    expect(problems[0]).toMatch(/"GitHub Issue"/);
    expect(problems[0]).toMatch(/case-sensitive/);
  });

  it("catches a lowercase Module, which would silently read as unassigned", () => {
    const database = validDatabase("Bugs");
    database.properties.module = database.properties.Module;
    delete database.properties.Module;

    expect(schemaProblems(database)).toEqual([
      expect.stringMatching(/"module" must be named exactly "Module"/),
    ]);
  });

  it("reports a property that is present but the wrong type", () => {
    const database = validDatabase();
    database.properties["Preview URL"] = { type: "rich_text" };

    expect(schemaProblems(database)).toEqual([
      expect.stringMatching(/"Preview URL" is a rich_text.*needs a url/),
    ]);
  });

  it("reports an entirely absent property", () => {
    const database = validDatabase();
    delete database.properties["Preview URL"];

    expect(schemaProblems(database)).toEqual([
      expect.stringMatching(/missing the "Preview URL" property/),
    ]);
  });

  it("rejects a Status select missing options the pipeline writes", () => {
    const database = validDatabase("Bugs");
    database.properties.Status.select.options = [
      { name: "Not started" },
      { name: "In progress" },
      { name: "Done" },
    ];

    const problems = schemaProblems(database);
    expect(problems).toHaveLength(1);
    for (const option of [
      "Ready for factory",
      "In factory",
      "Needs spec",
      "Previewed",
      "Shipped",
    ]) {
      expect(problems[0]).toContain(option);
    }
  });

  it("accepts extra Status options beyond the ones the pipeline writes", () => {
    const database = validDatabase();
    database.properties.Status.select.options.push({ name: "Wontfix" });

    expect(schemaProblems(database)).toEqual([]);
  });

  it("reports every problem at once, not just the first", () => {
    const database = validDatabase("Bugs");
    delete database.properties["Preview URL"];
    database.properties.Name = { type: "rich_text" };

    expect(schemaProblems(database).length).toBeGreaterThan(1);
  });

  it("does not throw on a database with no properties at all", () => {
    expect(schemaProblems({}).length).toBe(
      Object.keys(validDatabase().properties).length
    );
  });
});
