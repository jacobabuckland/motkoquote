---
description: Plan a goal into small tickets and run the owner/builder loop on each
argument-hint: <goal>
---
Goal: $ARGUMENTS

1. Read `factory/OWNER.md` and follow it for this whole run.
2. Run `factory/status.sh` to see open tickets and any existing backlog.
3. Explore the code the goal touches. Then write `.factory/backlog.md`: the goal as a heading and
   an ordered list of tickets sized for a small local model (1–3 files each, testable).
   If a backlog already exists, append to it instead of replacing it.
4. Show the human the backlog in one short list and say you are starting. Don't wait for approval
   unless the goal is ambiguous or a ticket needs something only they can provide.
5. For each unchecked ticket in order, run the full loop from OWNER.md: new-ticket, write the task
   file, build, gate, review, feedback rounds, ship, cleanup. Update the backlog marker as you go.
6. Stop early if a ticket is blocked on the human. Finish with the summary described in OWNER.md.
