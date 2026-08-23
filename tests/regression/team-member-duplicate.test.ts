import { describe, expect, it, vi } from "vitest";

// The reported defect, both halves of it.
//
// A contractor had Liam saved on their team (Apprentice, £120). Mid-call the
// agent asked who Liam was and recorded him again, leaving the team holding him
// twice — which then hands the drafting model two ids for one person.
//
// Two things were wrong and both are covered here: the agent was never told who
// was on the team, so peopleLine's "who you don't already know from their team"
// had nothing to consult; and recordTeamMember inserted unconditionally, so
// there was no backstop when the agent got it wrong anyway.

type TeamRow = { id: string; name: string; role?: string | null; day_rate?: number | null };

type Recorded = {
  inserts: Record<string, unknown>[];
  updates: { id: string; values: Record<string, unknown> }[];
};

const runWithTeam = async (team: TeamRow[]) => {
  const recorded: Recorded = { inserts: [], updates: [] };

  vi.resetModules();

  const instructionsSeen: string[] = [];

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.insert = (values: Record<string, unknown>) => {
          if (table === "team_members") recorded.inserts.push(values);
          return builder;
        };
        builder.update = (values: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            if (table === "team_members") recorded.updates.push({ id, values });
            return { error: null };
          },
        });
        builder.single = async () => ({
          data: table === "contractors" ? { id: "c-1", trade: "Electrician", first_name: "Dave" } : { id: "job-1" },
          error: null,
        });
        // team_members reads are awaited directly off .eq(), so that link in
        // the chain has to resolve to the roster rather than to the builder.
        builder.eq = () =>
          table === "team_members"
            ? Object.assign(Promise.resolve({ data: team, error: null }), builder)
            : builder;
        return builder;
      },
    }),
  }));
  vi.doMock("@/lib/analytics", () => ({ track: vi.fn(async () => {}), logError: vi.fn(async () => {}) }));
  vi.doMock("@/lib/realtime", () => ({
    createRealtimeClientSecret: vi.fn(async (config: { instructions: string }) => {
      instructionsSeen.push(config.instructions);
      return "secret-1";
    }),
  }));
  vi.doMock("@/lib/knowledge", () => ({
    findSimilarPastJobs: vi.fn(async () => []),
    syncQuoteKnowledge: vi.fn(),
  }));

  const actions = await import("@/app/jobs/actions");
  return { recorded, instructionsSeen, actions };
};

const SAVED_LIAM: TeamRow = { id: "tm-1", name: "Liam", role: "Apprentice", day_rate: 120 };

describe("recordTeamMember — someone already on the team is never added twice", () => {
  it("updates the saved member instead of inserting a second row", async () => {
    const { recorded, actions } = await runWithTeam([SAVED_LIAM]);

    await actions.recordTeamMember({ name: "Liam", role: "Apprentice", day_rate: 120 });

    expect(recorded.inserts).toEqual([]);
    expect(recorded.updates).toEqual([
      { id: "tm-1", values: { role: "Apprentice", day_rate: 120 } },
    ]);
  });

  it("matches however the name came back off the call", async () => {
    for (const heard of ["liam", "LIAM", "  Liam  "]) {
      const { recorded, actions } = await runWithTeam([SAVED_LIAM]);
      await actions.recordTeamMember({ name: heard, day_rate: 120 });
      expect(recorded.inserts, `"${heard}" should have matched the saved Liam`).toEqual([]);
      expect(recorded.updates).toHaveLength(1);
    }
  });

  it("takes the newer role and rate — saying it again is a correction", async () => {
    const { recorded, actions } = await runWithTeam([SAVED_LIAM]);

    await actions.recordTeamMember({ name: "Liam", role: "Electrician", day_rate: 200 });

    expect(recorded.updates).toEqual([
      { id: "tm-1", values: { role: "Electrician", day_rate: 200 } },
    ]);
  });

  it("still adds someone genuinely new", async () => {
    const { recorded, actions } = await runWithTeam([SAVED_LIAM]);

    await actions.recordTeamMember({ name: "Billy", role: "Labourer", day_rate: 140 });

    expect(recorded.updates).toEqual([]);
    expect(recorded.inserts).toEqual([
      { contractor_id: "c-1", name: "Billy", role: "Labourer", day_rate: 140 },
    ]);
  });

  it("adds the first member when the team is empty", async () => {
    const { recorded, actions } = await runWithTeam([]);

    await actions.recordTeamMember({ name: "Liam", role: "Apprentice", day_rate: 120 });

    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.updates).toEqual([]);
  });
});

describe("createRealtimeSession — the agent is told who is already on the team", () => {
  it("names the saved crew, their role and their rate in the instructions", async () => {
    const { instructionsSeen, actions } = await runWithTeam([SAVED_LIAM]);

    await actions.createRealtimeSession();

    expect(instructionsSeen).toHaveLength(1);
    const instructions = instructionsSeen[0];
    expect(instructions).toContain("Liam (Apprentice, £120/day)");
    expect(instructions).toMatch(/do NOT call record_person for them/);
  });

  it("says nothing about a team for a trade who has saved nobody", async () => {
    const { instructionsSeen, actions } = await runWithTeam([]);

    await actions.createRealtimeSession();

    expect(instructionsSeen[0]).not.toMatch(/team is already saved/);
  });

  it("does not smuggle past-job retrieval in alongside the roster", async () => {
    // The roster is Settings data — names, roles, rates. The retrieval that was
    // removed from this prompt injected whole priced quotes and must not come
    // back under cover of this change.
    const { instructionsSeen, actions } = await runWithTeam([SAVED_LIAM]);

    await actions.createRealtimeSession();

    expect(instructionsSeen[0]).not.toMatch(/Known context about this contractor/i);
  });
});
