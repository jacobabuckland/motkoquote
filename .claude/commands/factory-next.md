---
description: Take the next unchecked ticket from .factory/backlog.md and run it to a PR
---
1. Read `factory/OWNER.md` and follow it.
2. Open `.factory/backlog.md`. Pick the first ticket marked `- [ ]`. If there is none, say
   "backlog empty" and stop. If it depends on a PR that has not merged yet (`gh pr view <url>`),
   skip to the next one.
3. Mark it `- [~]`, then run the full loop from OWNER.md: new-ticket, write the task file, build,
   gate, review, feedback rounds, ship, cleanup.
4. Update its marker to `- [x]` with the PR link, or `- [!]` with the reason it is blocked.
5. Print a one-paragraph summary: ticket, outcome, PR link, rounds used.
