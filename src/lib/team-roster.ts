// The contractor's saved crew, in the two places that have to agree about it:
// what the live intake agent is told it already knows, and what
// recordTeamMember treats as "this person is already on the team".
//
// Matching is by NAME, normalised. A name is the only key available: the agent
// hears "Liam" over a phone line and has no id to offer, so the match has to be
// forgiving about how the name was typed into Settings versus how it was heard
// — trimmed, case-folded, inner whitespace collapsed.

export type TeamMember = {
  name: string;
  role?: string | null;
  day_rate?: number | null;
};

export const normaliseMemberName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

// The saved member this name refers to, or null if it's someone new. First
// match wins: a roster that already holds two rows for one name (the duplicate
// this module exists to stop being created) resolves to the older of them
// rather than adding a third.
export const findTeamMemberByName = <T extends { name: string }>(
  roster: T[],
  name: string,
): T | null => {
  const key = normaliseMemberName(name);
  if (!key) return null;
  return roster.find((member) => normaliseMemberName(member.name) === key) ?? null;
};

// One human-readable clause per person, for the intake instructions — "Liam
// (Apprentice, £120/day)". Role and rate are each included only when saved, so
// a half-filled row reads as what is actually known rather than as "null".
export const describeTeamMember = (member: TeamMember): string => {
  const details = [
    member.role?.trim() || null,
    typeof member.day_rate === "number" ? `£${member.day_rate}/day` : null,
  ].filter((detail): detail is string => detail !== null);

  return details.length > 0 ? `${member.name} (${details.join(", ")})` : member.name;
};

export const describeTeamRoster = (roster: TeamMember[]): string =>
  roster.map(describeTeamMember).join("; ");
