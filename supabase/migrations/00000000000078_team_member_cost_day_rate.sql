-- What a crew member COSTS, as distinct from what they are charged out at.
--
-- team_members.day_rate has always been a charge-out rate: compileDraftToLineItems
-- prices a quote's labour line with it, so it is revenue. Nothing on file said
-- what a person actually costs the business, so the money card's "Costs paid" —
-- which reads job_costs only — never saw a penny of wages. Reported 12 Sep 2026.
--
-- Nullable, and it stays nullable. An absent cost rate means "not costed", never
-- "costs nothing" and never "same as the charge-out rate": a guessed wage would be
-- invisible and confidently wrong on a money screen, which is the worse of the two
-- failures. crewCostPennies skips anyone without one and names them, so the card
-- can say whose days are missing rather than quietly under-counting.
--
-- Pounds, numeric(10,2), matching day_rate alongside it.
alter table team_members
  add column cost_day_rate numeric(10, 2);

comment on column team_members.cost_day_rate is
  'What this person costs per day (wages/subbie rate). NULL = not recorded, so their days are not costed. Distinct from day_rate, which is what the customer is charged for them.';
