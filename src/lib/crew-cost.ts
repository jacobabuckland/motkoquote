// What the crew on a job COST, as distinct from what they were charged out at.
//
// Asked on 12 Sep: "Does this include the employee day rates when on a job as a
// cost?" It did not, and it could not have. `team_members.day_rate` is a
// CHARGE-OUT rate — `compileDraftToLineItems` prices the quote's labour line with
// it (src/lib/compile-draft.ts), so it is revenue, and there was exactly one
// number on file doing that job. "Costs paid" reads `job_costs` only: materials,
// subcontractors, plant hire. Wages were nowhere on the card.
//
// `cost_day_rate` is the second number, and it is OPTIONAL on purpose. With no
// rate saved for someone, their days are NOT costed and their name comes back in
// `uncosted` so the card can say so. Defaulting to the charge-out rate would make
// margin on crew labour read £0 for every trade that marks their crew up, and
// defaulting to zero would read as "they were free" — both wrong, both silent.
//
// THE OWNER IS NEVER COSTED. Their days are drawings, not a cost to the business
// (Jacob's decision, 12 Sep — recorded in areas/motko.md). No special case is
// needed for it: the owner is not a row in `team_members`, so they never match the
// roster and fall straight out. The same is true of a person who has since been
// removed from the team — their historical days stop being costed, which is the
// conservative direction and is why `uncosted` only names people still on file.

import { findTeamMemberByName } from "@/lib/team-roster";

/** A roster row as this module needs it. */
export type CrewCostMember = {
  name: string;
  cost_day_rate: number | null;
};

export type CrewCost = {
  /** Integer pence. */
  pennies: number;
  /**
   * Crew who worked days this could not price, by the label the quote carries.
   * Deduplicated and in first-seen order. Empty is the good case.
   */
  uncosted: string[];
};

/**
 * One person on a labour line, as `linePersonSchema` stores them. Structural
 * rather than an import of `LinePerson`, because this must also read quotes
 * drafted before that schema settled — `days` and `day_rate` are the only fields
 * guaranteed present and `day_rate` is deliberately unused here.
 */
type QuotedPerson = { label?: unknown; days?: unknown };

/** A quote line as stored in `quotes.line_items_json`. */
type QuotedLine = { category?: unknown; people?: unknown };

// The quote labels a crew member "Liam (Apprentice)" when a role is on file and
// "Liam" when it is not (resolvePerson, src/lib/compile-draft.ts). Only the name
// is a key, so the role comes off before matching. Anchored to the END and
// non-greedy over the inner text, so a genuine bracket in a name — "Liam (Jr)
// Smith" — is untouched.
const stripRole = (label: string): string => label.replace(/\s*\([^()]*\)\s*$/, "");

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * What the crew on these line items cost, at the rates currently on file.
 *
 * Rates are read LIVE rather than frozen onto the quote. A trade correcting a
 * wrong cost rate expects yesterday's jobs to re-reckon, which is the opposite of
 * what a charged amount wants — and nothing here is charged to anybody.
 */
export const crewCostPennies = (
  lineItems: unknown,
  roster: CrewCostMember[],
): CrewCost => {
  if (!Array.isArray(lineItems)) return { pennies: 0, uncosted: [] };

  let pennies = 0;
  const uncosted: string[] = [];

  for (const raw of lineItems) {
    const line = raw as QuotedLine;
    if (line?.category !== "labour" || !Array.isArray(line.people)) continue;

    for (const rawPerson of line.people) {
      const person = rawPerson as QuotedPerson;
      const label = typeof person?.label === "string" ? person.label : "";
      const days = person?.days;
      if (!label || !isFiniteNumber(days) || days <= 0) continue;

      const member = findTeamMemberByName(roster, stripRole(label));
      // Not on the roster: the owner, or someone since removed. Not a cost this
      // can speak to, and not something to nag about either.
      if (!member) continue;

      if (!isFiniteNumber(member.cost_day_rate)) {
        if (!uncosted.includes(label)) uncosted.push(label);
        continue;
      }

      pennies += Math.round(days * member.cost_day_rate * 100);
    }
  }

  return { pennies, uncosted };
};
