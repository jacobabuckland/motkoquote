import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

describe("FACT-3: Make the three recurring acceptance-test traps unreachable", () => {
  describe("Supabase stub helper", () => {
    it("survives an arbitrary filter chain ending in await", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const rows = [
        { id: "job_1", status: "active", contractor_id: "contractor_1" },
        { id: "job_2", status: "active", contractor_id: "contractor_1" },
      ];

      const { client, select, from } = mockSupabaseClient(rows);

      // This is the chain that dies on a bare-promise stub: select().eq().eq()
      const result = await client
        .from("jobs")
        .select("id, status")
        .eq("status", "active")
        .eq("contractor_id", "contractor_1");

      expect(result.data).toEqual(rows);
      expect(result.error).toBeNull();

      // Assert the stub recorded the query
      expect(from).toHaveBeenCalledWith("jobs");
      expect(select).toHaveBeenCalledWith("id, status");
    });

    it("survives a filter chain ending in maybeSingle()", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const row = { id: "job_1", status: "active" };

      const { client } = mockSupabaseClient([row]);

      // The maybeSingle() call is where #639's stub died
      const result = await client
        .from("jobs")
        .select("*")
        .eq("id", "job_1")
        .maybeSingle();

      expect(result.data).toEqual(row);
      expect(result.error).toBeNull();
    });

    it("records the selected columns", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const { client, select } = mockSupabaseClient([]);

      await client.from("jobs").select("id, created_at, status");

      expect(select).toHaveBeenCalledWith("id, created_at, status");
    });

    it("records each filter in the chain", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const { client, getFilters } = mockSupabaseClient([]);

      await client
        .from("jobs")
        .select("*")
        .eq("status", "active")
        .eq("contractor_id", "contractor_1")
        .not("archived_at", "is", null);

      const filters = getFilters();

      expect(filters).toEqual([
        { method: "eq", args: ["status", "active"] },
        { method: "eq", args: ["contractor_id", "contractor_1"] },
        { method: "not", args: ["archived_at", "is", null] },
      ]);
    });
  });

  describe("NextRequest factory helper", () => {
    it("creates a properly typed Request for route handler testing", async () => {
      const { createNextRequest } = await import("../helpers/next-request");

      const request = createNextRequest({
        method: "POST",
        url: "http://localhost:3000/api/jobs",
        body: { contractor_id: "contractor_1" },
        headers: { "Content-Type": "application/json" },
      });

      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost:3000/api/jobs");

      const body = await request.json();
      expect(body).toEqual({ contractor_id: "contractor_1" });
    });

    it("defaults to GET with no body", async () => {
      const { createNextRequest } = await import("../helpers/next-request");

      const request = createNextRequest({
        url: "http://localhost:3000/api/jobs/123",
      });

      expect(request.method).toBe("GET");
    });
  });

  describe("check-acceptance-types.sh gate", () => {
    const scriptPath = join(process.cwd(), "scripts/factory/check-acceptance-types.sh");

    it("reports TS2493 (tuple index out of bounds)", () => {
      // TS2493: Tuple type '[...]' of length '0' has no element at index '0'
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2493.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2493.log");
      const fixtureLog = `${fixtureTestPath}(42,57): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2493");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });
        // Should have exited non-zero
        expect.fail("Expected check-acceptance-types.sh to reject TS2493");
      } catch (error: unknown) {
        const err = error as { status: number; stderr: Buffer };
        expect(err.status).toBe(1);
        expect(err.stderr.toString()).toContain("TS2493");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });

    it("reports TS2339 on never type (tuple indexing)", () => {
      // TS2339: Property '0' does not exist on type 'never'
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2339-never.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2339-never.log");
      const fixtureLog = `${fixtureTestPath}(96,23): error TS2339: Property '0' does not exist on type 'never'.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2339 on never");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });
        expect.fail("Expected check-acceptance-types.sh to reject TS2339 on never");
      } catch (error: unknown) {
        const err = error as { status: number; stderr: Buffer };
        expect(err.status).toBe(1);
        expect(err.stderr.toString()).toContain("TS2339");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });

    it("stays silent on TS2339 for a module namespace (correct failing-first)", () => {
      // This is #403's legitimate diagnostic: the export doesn't exist YET
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2339-module.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2339-module.log");
      const fixtureLog = `${fixtureTestPath}(42,23): error TS2339: Property 'formatWhatsLeftResponse' does not exist on type 'typeof import(".../ledger-query-prompt")'.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2339 module namespace");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        const result = execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });

        expect(result).toContain("no self-contradicting type errors");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });

    it("stays silent on TS2339 for a property the item is about to add (correct failing-first)", () => {
      // This is #403's other legitimate diagnostic: (await getWhatsLeft()).total
      // The item changes getWhatsLeft from Promise<number> to Promise<WhatsLeftAnswer>
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2339-property.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2339-property.log");
      const fixtureLog = `${fixtureTestPath}(58,45): error TS2339: Property 'total' does not exist on type 'number'.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2339 property");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        const result = execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });

        expect(result).toContain("no self-contradicting type errors");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });

    it("reports Expected 0 arguments but got N", () => {
      // vi.fn(async () => ...) infers zero arguments, so calling with one is an error
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2554-zero-to-n.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2554-zero-to-n.log");
      const fixtureLog = `${fixtureTestPath}(123,45): error TS2554: Expected 0 arguments, but got 1.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2554 zero to N");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });
        expect.fail("Expected check-acceptance-types.sh to reject TS2554 (0 to N)");
      } catch (error: unknown) {
        const err = error as { status: number; stderr: Buffer };
        expect(err.status).toBe(1);
        expect(err.stderr.toString()).toContain("TS2554");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });

    it("reports Expected N arguments but got 0", () => {
      // vi.fn(async (_id: string) => ...) requires one, so calling with zero is an error
      const fixtureTestPath = join(process.cwd(), "tests/fixtures/ts2554-n-to-zero.test.ts");
      const fixtureLogPath = join(process.cwd(), "tests/fixtures/ts2554-n-to-zero.log");
      const fixtureLog = `${fixtureTestPath}(67,23): error TS2554: Expected 1 arguments, but got 0.`;

      writeFileSync(fixtureTestPath, "// Fixture test file for TS2554 N to zero");
      writeFileSync(fixtureLogPath, fixtureLog);

      try {
        execSync(`bash ${scriptPath} ${fixtureTestPath} ${fixtureLogPath}`, {
          encoding: "utf-8",
        });
        expect.fail("Expected check-acceptance-types.sh to reject TS2554 (N to 0)");
      } catch (error: unknown) {
        const err = error as { status: number; stderr: Buffer };
        expect(err.status).toBe(1);
        expect(err.stderr.toString()).toContain("TS2554");
      } finally {
        unlinkSync(fixtureTestPath);
        unlinkSync(fixtureLogPath);
      }
    });
  });

  describe("check-acceptance-static.sh gate", () => {
    const scriptPath = join(process.cwd(), "scripts/factory/check-acceptance-static.sh");

    it("rejects the dotAll regex flag /s", () => {
      const fixturePath = join(process.cwd(), "tests/fixtures/dotall-test.ts");
      const fixtureContent = `
import { describe, it, expect } from "vitest";

describe("Example", () => {
  it("uses dotAll flag", () => {
    const text = "line1\\nline2";
    // The /s flag is TS1501 at ES2017
    expect(text).toMatch(/line1.*line2/s);
  });
});
`;

      writeFileSync(fixturePath, fixtureContent);

      try {
        execSync(`bash ${scriptPath} ${fixturePath}`, { encoding: "utf-8" });
        expect.fail("Expected check-acceptance-static.sh to reject /s flag");
      } catch (error: unknown) {
        const err = error as { status: number; stderr: Buffer };
        expect(err.status).toBe(1);
        const output = err.stderr.toString();
        expect(output).toContain("dotAll");
        expect(output).toContain("[\\s\\S]");
      } finally {
        unlinkSync(fixturePath);
      }
    });

    it("accepts the ES2017-compatible [\\s\\S] pattern", () => {
      const fixturePath = join(process.cwd(), "tests/fixtures/no-dotall-test.ts");
      const fixtureContent = `
import { describe, it, expect } from "vitest";

describe("Example", () => {
  it("uses ES2017-compatible pattern", () => {
    const text = "line1\\nline2";
    // [\\s\\S] matches the same as . with /s, but compiles at ES2017
    expect(text).toMatch(/line1[\\s\\S]*line2/);
  });
});
`;

      writeFileSync(fixturePath, fixtureContent);

      try {
        const result = execSync(`bash ${scriptPath} ${fixturePath}`, {
          encoding: "utf-8",
        });

        expect(result).toContain("clean");
      } finally {
        unlinkSync(fixturePath);
      }
    });
  });

  describe("AGENTS.md documentation", () => {
    it("mandates the Supabase helper in the same terms as Capacitor", async () => {
      const mod = await import("@/../AGENTS.md?raw");
      const agentsContent = mod.default;

      expect(agentsContent).toContain("Supabase mocking");
      expect(agentsContent).toContain("tests/helpers/supabase.ts");
      expect(agentsContent).toMatch(/Do \*\*not\*\* write custom.*Supabase/i);
    });

    it("mandates the NextRequest helper", async () => {
      const mod = await import("@/../AGENTS.md?raw");
      const agentsContent = mod.default;

      expect(agentsContent).toContain("tests/helpers/next-request.ts");
    });

    it("documents the dotAll flag ban", async () => {
      const mod = await import("@/../AGENTS.md?raw");
      const agentsContent = mod.default;

      expect(agentsContent).toMatch(/dotAll|\/s flag|regex.*\\[\\\\s\\\\S\\]/i);
    });
  });

  describe("tsconfig.json compile target", () => {
    it("still targets ES2017", async () => {
      const mod = await import("@/../tsconfig.json?raw");
      const tsconfigContent = mod.default;
      const tsconfig = JSON.parse(tsconfigContent);

      expect(tsconfig.compilerOptions.target).toBe("ES2017");
    });
  });
});
