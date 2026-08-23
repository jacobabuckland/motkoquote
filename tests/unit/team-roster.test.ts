import { describe, expect, it } from "vitest";
import {
  describeTeamMember,
  describeTeamRoster,
  findTeamMemberByName,
  normaliseMemberName,
} from "@/lib/team-roster";

// The agent works from a name it heard down a phone line, so matching has to
// survive the difference between how a name was typed into Settings and how it
// comes back mid-call.

describe("normaliseMemberName", () => {
  it("folds case, trims, and collapses inner whitespace", () => {
    expect(normaliseMemberName("  Liam  ")).toBe("liam");
    expect(normaliseMemberName("LIAM")).toBe("liam");
    expect(normaliseMemberName("Liam   O'Neill")).toBe("liam o'neill");
  });
});

describe("findTeamMemberByName", () => {
  const roster = [
    { id: "tm-1", name: "Liam" },
    { id: "tm-2", name: "Sam Patel" },
  ];

  it("finds the saved member however the name was cased or spaced", () => {
    expect(findTeamMemberByName(roster, "liam")?.id).toBe("tm-1");
    expect(findTeamMemberByName(roster, "  LIAM ")?.id).toBe("tm-1");
    expect(findTeamMemberByName(roster, "Sam   Patel")?.id).toBe("tm-2");
  });

  it("returns null for someone genuinely new", () => {
    expect(findTeamMemberByName(roster, "Billy")).toBeNull();
  });

  it("does not match a different person whose name merely contains theirs", () => {
    expect(findTeamMemberByName(roster, "Liam Jr")).toBeNull();
    expect(findTeamMemberByName(roster, "Sam")).toBeNull();
  });

  it("treats a blank name as no match rather than matching the first row", () => {
    expect(findTeamMemberByName(roster, "   ")).toBeNull();
  });

  it("resolves an already-duplicated roster to the older row, never a third", () => {
    const duplicated = [
      { id: "tm-1", name: "Liam" },
      { id: "tm-2", name: "liam" },
    ];
    expect(findTeamMemberByName(duplicated, "Liam")?.id).toBe("tm-1");
  });
});

describe("describeTeamMember", () => {
  it("reads as the role and rate actually saved", () => {
    expect(describeTeamMember({ name: "Liam", role: "Apprentice", day_rate: 120 })).toBe(
      "Liam (Apprentice, £120/day)",
    );
  });

  it("leaves out whichever detail is missing rather than saying null", () => {
    expect(describeTeamMember({ name: "Liam", role: null, day_rate: 120 })).toBe("Liam (£120/day)");
    expect(describeTeamMember({ name: "Liam", role: "Apprentice", day_rate: null })).toBe(
      "Liam (Apprentice)",
    );
    expect(describeTeamMember({ name: "Liam" })).toBe("Liam");
    expect(describeTeamMember({ name: "Liam", role: "   ", day_rate: null })).toBe("Liam");
  });

  it("keeps a zero day rate — it is a figure, not a missing value", () => {
    expect(describeTeamMember({ name: "Liam", day_rate: 0 })).toBe("Liam (£0/day)");
  });
});

describe("describeTeamRoster", () => {
  it("lists everyone", () => {
    expect(
      describeTeamRoster([
        { name: "Liam", role: "Apprentice", day_rate: 120 },
        { name: "Sam", role: "Electrician", day_rate: 240 },
      ]),
    ).toBe("Liam (Apprentice, £120/day); Sam (Electrician, £240/day)");
  });

  it("is empty for a trade with nobody saved", () => {
    expect(describeTeamRoster([])).toBe("");
  });
});
