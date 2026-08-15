# Blocked ticket review

**Audited `main` @ `5a97b1f`** ("Report a rejected push as a rejected push (#209)"), with each
factory branch read at its current head. Reviewed 2026-08-15.

Scope: the 12 items carrying a live `DECISION NEEDED` block per the 15 Aug decisions digest
(#157) — #96, #123, #127, #170, #178, #195, #199, #211, #212, #215, #216, #219. Nine carry the
`blocked` label; #123, #178 and #199 are blocked without it (they carry `qa-disputed`), and no
labelled item is un-blocked. No open PR carries a `DECISION NEEDED` of its own — every blocker
comment lives on the issue.

`gh` is not installed in this environment; all GitHub reads were done through the GitHub MCP
tools, which hit the same API. Failing-job logs were read in full, and every claim marked
"verified" below was reproduced locally by checking out the branch, installing that branch's
lockfile, and running the command quoted.

One rule matters throughout: CI permits **only a branch's first commit** to touch
`tests/acceptance/` or `docs/specs/` (`ci.yml`, jobs `acceptance-test-immutability` and
`spec-immutability`). So "fix the frozen test" always means *amend the branch's first commit and
force-push*, never "add a commit".

---

## #96 — Add haptics utility and wire it to resolved actions

**Blocked because:** the gate fails on `src/lib/haptics.ts(73,7): error TS2578: Unused
'@ts-expect-error' directive` — and that single type error is masking four real failures in the
frozen acceptance test, which still asserts a Capacitor API that does not exist.

**Agent asked:** the gate is red on the Engineer's own commit — send it back to the Engineer, or
is the failure in the acceptance test it cannot edit?

**Agent recommended:** read the failing job; if the error names `tests/acceptance/`, it is (b) and
no Engineer re-run can fix it; anything else is (a).

**My verdict:** Disagree with where that heuristic lands. The error names `src/lib/haptics.ts`, so
the rule says (a) — send it back to the Engineer. That is wrong, and it would burn another cycle.
The answer is *both*, and the type error is the smaller half. Verified: deleting the stale
directive makes `npx tsc --noEmit` exit clean, and then `tests/acceptance/96.test.tsx` fails 4 of
18:

```
× success() calls Haptics.notification with success type   expected { type: "SUCCESS" } to equal { type: "success" }
× error() calls Haptics.notification with error type       expected { type: "ERROR" }   to equal { type: "error" }
× select() calls Haptics.selection                         expected "selectionChanged"  to be "selection"
× checkbox fires haptics.select() on change                no call with method "selection"
```

The implementation is right and the test is wrong: `@capacitor/haptics` exports
`NotificationType.Success = "SUCCESS"`, and there is no `selection()` method — only
`selectionStart/Changed/End`. The 13 Aug adjudication on this issue already fixed the *impact*
literals to uppercase in the spec commit and left the *notification* literals and the method name
behind; the test file's own comment at lines 100–103 explains why uppercase is required, which
makes the remaining lowercase assertions self-contradicting. This is the CLAUDE.md rule in the
flesh — a typecheck failure masking worse.

**Fix:**
1. `src/lib/haptics.ts` — delete the now-unused `// @ts-expect-error - Capacitor provides
   selectionChanged, not selection` line above `Haptics.selectionChanged()` (line 73).
2. Amend `factory/96`'s first commit `8280d98` (`spec: derive spec and acceptance tests for #96`)
   to fix `tests/acceptance/96.test.tsx`: line 127 → `{ type: "SUCCESS" }`, line 139 →
   `{ type: "ERROR" }`, line 150 → `"selectionChanged"`, line 249 → `c.method ===
   "selectionChanged"`. Force-push.
3. `./scripts/factory/resume.sh 96 verify` — the implementation is complete, so `spec-derived`
   would re-run the Engineer, find nothing, and block again.

**Effort:** small.
**Confidence:** high — I ran the typecheck and the suite on the branch and read the failures.

---

## #123 — [BACKFILL] Correct duplicate referral_unlock credits

**Blocked because:** the Engineer reports a genuine self-contradiction in the spec — line 4 says
"**No database migration required**", while derived criterion (line 127) requires each
contractor's delete + decrement to be "one atomic transaction". Those cannot both hold, and the
shipped code papered over it by calling `admin.rpc("begin_transaction"/"commit_transaction"/
"rollback_transaction")`, which do not exist and would fail at runtime.

**Agent asked:** was this a transient infrastructure failure, or did the Engineer stage genuinely
fail on this item?

**Agent recommended:** (a) re-run the Engineer once; if the same step fails twice it is a factory
fault needing a handler.

**My verdict:** Disagree, and the question itself is stale. It was composed at 12 Aug 20:12 and
superseded 63 minutes later by the Engineer's `SPEC ERROR` dispute at 21:15, which the digest never
picked up — so the digest has been asking a dead question for three days. Retrying an agent cannot
resolve a contradiction in the contract it is judged against; it will produce the same dispute. On
the merits the Engineer is right: Supabase has no client-side transaction control, and the
codebase's own pattern is a single atomic DB function (migration
`00000000000032_increment_free_jobs_remaining.sql`; `src/lib/settle-paid-job.ts`). QA was also
right, for the right reason, on the same point.

**Fix:** this needs a decision, not a re-run.
1. Recommended resolution — allow the migration. Amend the first commit `f97fd98` to strike "no
   database migration required" and add a `correct_referral_duplicate(p_contractor_id,
   p_event_ids_to_delete, p_decrement_amount)` `SECURITY DEFINER` function to the file list; have
   the Engineer call it instead of the phantom transaction RPCs. Per CLAUDE.md, apply that
   migration to prod with `supabase db push` **before** merging the code, and confirm with
   `supabase migration list`.
2. While amending, decide the five async-runner tests at `tests/acceptance/123.test.ts:806-866`,
   which are `expect(true).toBe(true)` placeholders — QA flagged them and the Engineer cannot touch
   them. Either implement them in the amendment or delete them; leaving them is a test that cannot
   fail.
3. Then `./scripts/factory/resume.sh 123 qa-changes`.

**Effort:** needs-a-think.
**Confidence:** high on the diagnosis (I read both spec lines and the dispute); medium on the
recommended resolution — "may this backfill add a migration" is your call, not a technical one.

---

## #127 — Add exit animation and success variant to Toast

**Blocked because:** `factory/127` conflicts with `main` in `src/app/globals.css`. GitHub cannot
build the `refs/pull/138/merge` ref for a conflicted PR, so it never creates a `pull_request` CI
run at all — the gate has not run on this branch since 11 Aug.

**Agent asked:** CI never ran on the Engineer's commit — is the draft PR for `factory/127` still
open?

**Agent recommended:** check the PR first; CI is triggered by the pull request, so a closed or
missing PR means no run will ever arrive.

**My verdict:** Disagree — neither offered option is the cause. PR #138 is open, is a draft, and
has been open continuously; it was never closed. Verified: `git merge-tree --write-tree origin/main
origin/factory/127` reports `CONFLICT (content): Merge conflict in src/app/globals.css`. The whole
branch has exactly **one** CI run ever (`31544128262`, on the spec commit `e72df93`, 11 Aug); the
later commits `59eb577` and `c1be72e` produced none. The tell that it is not "CI is slow" is in the
check list on PR #138: Vercel Preview Comments and GitGuardian both ran on the 13 Aug push, because
GitHub Apps receive the push webhook directly and do not need a merge ref. Only Actions is missing.
The factory then waited 900s for a run that could never be created and reported the silence as a
question about the PR's existence.

**Fix:**
1. `git checkout factory/127 && git merge origin/main`, resolve `src/app/globals.css`, push. CI
   fires on the resulting `synchronize` and the real state of the branch becomes visible for the
   first time in four days.
2. Only then judge the gate. Do not resume the Engineer before that — the digest records that #127
   "burned two full budgets", so also check its Implement runs against the turn cap (see #211).

**Effort:** small.
**Confidence:** high — the conflict, the single CI run, and the app-vs-Actions split are all
directly observed.

---

## #170 — Anchor every acceptance criterion to a named test assertion

**Blocked because:** the Engineer has produced no changes across four runs; `factory/170` contains
only the PM's spec commit `0c14eff` (`docs/specs/170.md` + `tests/acceptance/170.test.ts`) and no
implementation whatsoever.

**Agent asked:** the Engineer produced no changes — is the work already complete on the branch, or
did it fail to do any?

**Agent recommended:** run the acceptance tests on the branch; if they pass it is (a) the work is
complete, and note they can also fail for reasons the Engineer cannot fix.

**My verdict:** Agree with the method, and it settles cleanly to (b) — it did nothing. Verified on
the branch: **12 failed, 10 passed of 22**. The failures are exactly the unbuilt artefacts —
`creates the validation script at scripts/factory/validate-anchored-criteria.sh`, `is executable`,
`includes the anchoring requirement in the PM prompt`, `adds a validation step after artefact
verification`. The 10 that pass are assertions about things that already exist or are unchanged
(`does not change the QA iteration cap`, `does not change the label state machine`), so they would
pass against an empty branch — the tests are not shadowed or mis-wired, there is simply nothing to
test.

The open question is *why* it did nothing, four times. This item's whole job is to edit
`.github/workflows/factory-pm.yml` and `factory-qa.yml` and add a script under `scripts/factory/`.
The Engineer's push step contains a dedicated handler for a push rejected because it touches
workflow files ("the implementation is reproducible — it is refused at the remote, not missing"),
which means a token without `workflow` scope is a known failure mode here. That is a hypothesis, not
a finding: the runs I read reported "produced no changes" (the agent wrote nothing), not a rejected
push, so the two do not yet join up.

**Fix:**
1. Before resuming, confirm `FACTORY_TOKEN` carries the `workflow` scope, and read the *Implement*
   step output of run `31748166935` for what the agent said it was doing — that is the one piece of
   evidence I could not extract, and it will say whether it refused the task or silently no-op'd.
2. `./scripts/factory/resume.sh 170 spec-derived`.

**Effort:** needs-a-think.
**Confidence:** high that nothing is implemented and (b) is the answer; **low** on the cause of the
repeated no-op. To raise it I need the Implement step's agent transcript from run `31748166935`
(and `31641008107`), specifically whether it ends in `end_turn` with no edits or in a refusal.

---

## #178 — Detect offline from failed fetches rather than navigator.onLine

**Blocked because:** the spec and its own frozen acceptance test disagree about which `204`
responses mean "offline", and the implementation can satisfy only one of them.

**Agent asked:** the Engineer says the spec itself is wrong — is it?

**Agent recommended:** read the Engineer's evidence; it has no incentive to invent a spec error,
but check the Notion card before accepting that the spec is wrong.

**My verdict:** Agree the contradiction is real — I verified both files — but I disagree with the
framing, and it changes the fix. The spec is the half that is *right*; the test is wrong.
`docs/specs/178.md:32` scopes it carefully: "a status indicating a captive portal (204 from a
connectivity check that should return 200)". The frozen test at
`tests/acceptance/178.test.tsx:256-274` fetches `/api/test-1` and `/api/test-2` — generic
endpoints, not a connectivity check — and requires the banner to appear; its own comment says
"Captive portal may return 204 for connectivity checks" while testing the opposite. To pass it, the
implementation treats every 204 as a network failure. That is a real user-facing bug, exactly as QA
said: `204 No Content` is the normal success status for a `DELETE` or a bodyless `PUT`, so two
successful deletes will now tell the user they are offline.

So this should not be recorded as "the spec was wrong". Answering (a) as written would amend the
correct document to match the defective test and bake the bug in permanently.

QA's second finding (tests should call `resetFetchMonitor()`) is correct in substance and
unactionable by the Engineer — it requires editing the frozen file. Fold it into the same
amendment.

**Fix:**
1. Amend `factory/178`'s first commit `663f0da` to fix *the test*: point the 204 case at a named
   connectivity-check URL, and add `resetFetchMonitor()` to the describe block's `afterEach`.
2. In the same commit, sharpen `docs/specs/178.md` to name that connectivity-check URL, since the
   scoping is currently prose the implementation cannot act on. This is the one genuine gap in the
   spec — it says "a connectivity check" without ever saying which.
3. `src/lib/fetch-monitor.ts:335-337` — scope the `status === 204` branch to that URL instead of
   returning `true` unconditionally.
4. `./scripts/factory/resume.sh 178 qa-changes`.

**Effort:** needs-a-think — step 2 needs someone to decide what the connectivity-check endpoint is.
**Confidence:** high on the contradiction and on which side is wrong; medium on the fix shape, since
the endpoint choice is undecided.

---

## #195 — Add a post-deploy health check gating promotion to production

**Blocked because:** the Engineer produced no changes; `factory/195` holds only the spec commit
`6a4a09f` and nothing has been built.

**Agent asked:** the Engineer produced no changes — is the work already complete on the branch, or
did it fail to do any?

**Agent recommended:** run the acceptance tests; if they pass it is (a).

**My verdict:** Agree with the method; the answer is (b), unambiguously and more starkly than
anywhere else in this batch. Verified: **29 of 29 tests fail**, and they fail at the first hurdle
with `Error: No health check workflow found` and `Error: No health check script found`. There is
nothing on the branch to review, so `verify` would waste a QA cycle.

Same caveat as #170, and it is the stronger case of the two: this item's deliverable *is* a
workflow file, so if `FACTORY_TOKEN` cannot push `.github/workflows/**` the Engineer can never land
it. #170 and #195 are the only two blocked items whose output is workflow files, and they are the
only two showing this repeated silent no-op — that correlation is suggestive but I have not
confirmed the mechanism.

**Fix:**
1. Confirm `FACTORY_TOKEN` has `workflow` scope (this likely fixes #170 and #195 together).
2. `./scripts/factory/resume.sh 195 spec-derived`.
3. If it no-ops a third time, read the Implement step transcript of run `31748124257` before
   spending another run.

**Effort:** needs-a-think.
**Confidence:** high that nothing exists; **low** on the cause, same evidence gap as #170.

---

## #199 — Wire the native share sheet for quote, invoice and contract links

**Blocked because:** two separate things, and the one the digest is asking about is stale.
`factory/199` conflicts with `main` in `tests/helpers/capacitor.ts`, so — exactly as with #127 — PR
#201 gets no CI run at all. Separately, QA cycle 2 left a cosmetic finding open.

**Agent asked:** CI is red on the Engineer's commit — is the failure in its implementation, or in
the acceptance test it may not edit?

**Agent recommended:** read the failing job; if the error names `tests/acceptance/`, no Engineer
re-run can fix it.

**My verdict:** Disagree with the premise. The question dates from 12 Aug and refers to gate run
`31649478176` on commit `7368086`. Four commits have landed since, and none of them has been tested:
PR #201's check list contains only Vercel Preview Comments and GitGuardian — **no gate run**. So
"CI is red" is no longer true; CI is *absent*, for the same reason as #127. Verified: `git
merge-tree` reports `CONFLICT (content): Merge conflict in tests/helpers/capacitor.ts`. Asking
whether the red job names `tests/acceptance/` cannot be answered because there is no job.

Worth noting how the conflict arose: #96 rewrote the shared Capacitor mock (its adjudication
comment says the change was made "so the shared Capacitor mock does not need to export
`ImpactStyle`— a change several other items' tests depend on") and #199 edits the same helper.
Two blocked items are fighting over one shared test helper.

QA cycle 2's actual finding is minor and real: `src/components/ui/share-link-button.tsx` carries a
comment claiming "ImpactStyle enum is uppercase" directly above code passing lowercase `"medium"`,
plus an unnecessary `as ImpactStyle` cast. Note this contradicts the #96 adjudication, which
established that uppercase is required on a device — worth reconciling the two rather than just
deleting the comment.

**Fix:**
1. `git checkout factory/199 && git merge origin/main`, resolve `tests/helpers/capacitor.ts` —
   keep the uppercase-literal mock shape #96 settled on — and push. Let the gate actually run.
2. Reconcile the haptics call in `share-link-button.tsx` with #96's finding (uppercase on device),
   rather than adopting QA cycle 2's "lowercase is right" reading uncritically.
3. Re-judge from the gate result; if green, `./scripts/factory/resume.sh 199 verify`.

**Effort:** small for the merge; the haptics reconciliation is a think.
**Confidence:** high on the missing CI and the conflict; medium on step 2, which depends on which
of two contradictory QA verdicts you accept.

---

## #211 — PAY-5: Deprecate and remove TrueLayer integration

**Blocked because:** the Engineer **completed the entire item** and the factory threw the work away.
The run ended `"subtype": "success"`, `"stop_reason": "end_turn"`, 117 turns, $3.04 — and then the
action failed it retroactively:

```
##[error]Claude reported a successful result after 117 turns, exceeding the configured maximum of 80
```

Because the *Implement* step exited non-zero, the *Push implementation* step never ran, so none of
it was committed. `factory/211` still contains only the spec commit `3d98c29`.

**Agent asked:** the agent step itself failed on this item — did it exhaust its turn budget, or
error out?

**Agent recommended:** check the log for the turn cap first; `Reached maximum number of turns`
means the item is too large or the agent is looping, and neither is fixed by retrying.

**My verdict:** Partly agree, and the part it gets wrong is the expensive part. It is the turn cap
(`--max-turns 80`, `.github/workflows/factory-engineer.yml:192`), and a bare retry will hit it
again — that much is right. But the diagnosis offered ("too large, or looping") is wrong on the
evidence: the agent did not run out of road and it was not looping. It finished, self-reported
"typecheck passes, lint passes, build passes, 899/900 tests pass, 21 of 22 acceptance tests for
#211 pass", and was then failed for having taken too many turns to succeed. The cap is enforced
*after* the result rather than as a ceiling during the run, and the workflow discards completed work
on that path. That is a factory defect worth more than this ticket.

The Engineer also independently found the same unsatisfiable assertion I did. Verified:
`tests/acceptance/211.test.ts:230` requires `/remove.*environment.*variable/i`, and `.` does not
match newlines, so it must match within one line. The spec — committed in the *same* commit — only
ever writes it the other way round: "Document seven TrueLayer environment variables **to remove**
from production" (line 199), "**To remove** from production environments and CI secrets" (line 131,
no "variable"). No implementation can satisfy it, and the Engineer may edit neither file. Running
the suite on the branch today gives 21 failed / 1 passed, consistent with nothing being built.

**Fix:**
1. Raise `--max-turns` in `.github/workflows/factory-engineer.yml:192` (117 turns for a deletion of
   this size is not pathological — 160 would give headroom), or split PAY-5 into "delete code" and
   "update docs".
2. Separately, fix the discard: the Implement step should commit and push whatever exists before
   the turn-cap assertion runs, so a successful-but-over-cap run is recoverable rather than lost.
3. Amend the first commit `3d98c29` to reword the spec so the frozen regex is satisfiable — e.g.
   make the §"Environment variables" heading read "Remove the following environment variables from
   production environments and CI secrets".
4. `./scripts/factory/resume.sh 211 spec-derived`.

**Effort:** needs-a-think (step 2 is real workflow surgery; steps 1 and 3 are minutes).
**Confidence:** high — the turn-cap error, the success subtype, the empty branch and the
unsatisfiable regex are all directly observed.

---

## #212 — PAY-6: Update payment trust copy and all TrueLayer references

**Blocked because:** the gate fails inside **another item's** frozen acceptance test.
`tests/acceptance/152.test.tsx:202` asserts the old TrueLayer reassurance wording, which is
precisely the copy #212 is chartered to replace. The test fails on a `getByText` for copy that no
longer exists.

**Agent asked:** the gate is red on the Engineer's own commit — implementation, or the acceptance
test it cannot edit?

**Agent recommended:** if the error names `tests/acceptance/`, it is (b) — amend the branch's first
commit by hand.

**My verdict:** Agree it is (b), with one correction that matters for how you execute it. The frozen
file is `152.test.tsx`, not `212.test.tsx` — a *different ticket's* contract, one #212 was always
going to invalidate. The immutability check is path-based, not per-issue (it rejects any commit
after the first that touches `tests/acceptance/` at all), so folding the deletion into #212's first
commit does satisfy it — but the framing "fix your acceptance test" hides that this is a
cross-ticket ordering problem, not a defect in #212's own contract.

There is already a plan for this file: #211's spec, item 7, schedules deleting
`tests/acceptance/93.test.ts` and `tests/acceptance/152.test.tsx`. Two tickets are queued to delete
the same file, and whichever lands second will conflict.

**Fix:** pick an order.
- Preferred — land #211 first (it deletes `152.test.tsx` as part of the TrueLayer removal), then
  rebase `factory/212` onto the new `main`; #212's gate goes green with no test edit at all.
- If #212 must ship first — amend its first commit `b925d53` to delete
  `tests/acceptance/152.test.tsx`, and drop item 7 from #211's spec so the two do not collide.

Either way, decide it once and record it, because #211/#212/#215/#216/#219 are one migration
sharing a file set.

**Effort:** small.
**Confidence:** high on the cause; medium on which ordering you want — that is a sequencing
preference, not a technical constraint.

---

## #215 — PAY-4: Fee collection at source via application fees

**Blocked because:** the Engineer produced no changes on two consecutive runs; `factory/215` holds
only the spec commit `0315cc7`. The modules the tests import do not exist because the tickets that
create them (#216, #219) have not landed.

**Agent asked:** the Engineer produced no changes — is the work already complete on the branch, or
did it fail to do any?

**Agent recommended:** run the acceptance tests; if they pass it is (a).

**My verdict:** Agree with the method; the answer is (b). But this branch is the sharpest
illustration of why that heuristic is dangerous, and it nearly gives the wrong answer. The suite
reports **16 passed, 2 failed of 18** — 89% green on a branch where *not one line* has been
written. The two real failures are `Cannot find package '@/lib/stripe-payments'` and `Cannot find
package '@/app/api/stripe/webhook/route'`. The other 16 assert on the prose of `docs/specs/215.md`,
which the PM committed, so they pass against an empty implementation. A reviewer who applied the
stated rule loosely — "mostly passing, must be complete, resume at `verify`" — would ship nothing to
QA and burn a cycle.

The two missing modules are the outputs of #216 (Stripe Connect) and #219 (Pay by Bank). That makes
a dependency the likeliest reason the Engineer produced nothing, though I did not confirm it from
the agent transcript.

**Fix:**
1. Land #219 and #216 first (both are close — see below).
2. Then `./scripts/factory/resume.sh 215 spec-derived`.
3. Independently: those 16 spec-prose assertions should not count as acceptance criteria. This is
   the defect #170 exists to fix.

**Effort:** needs-a-think — it is gated on two other tickets rather than on any work of its own.
**Confidence:** high that nothing is built; medium on the dependency being the Engineer's actual
reason for stopping. Reading the Implement transcript of run `31755352783` would settle it.

---

## #216 — PAY-2: Stripe Connect Express onboarding for contractors

**Blocked because:** two failing jobs, and the DECISION NEEDED only accounts for one of them.
`gate` fails on `src/lib/stripe.ts(30,5): error TS2322: Type '"2025-01-27.acacia"' is not
assignable to type '"2026-07-29.dahlia"'` — a stale pinned Stripe API version. `secret-scan` fails
too, and it is a **false positive**.

**Agent asked:** the gate is red on the Engineer's own commit — implementation, or the acceptance
test it cannot edit?

**Agent recommended:** read the failing job; if the error names `tests/acceptance/`, it is (b).

**My verdict:** Partly agree. The gate failure is (a) and is a one-line fix, so the heuristic gets
that right. Two things it misses:

*The secret-scan job is never mentioned in the question,* and no Engineer re-run will clear it. The
pattern is `sk_live_` as a bare literal (`ci.yml:138`), with no requirement for an actual key body
after the prefix. It is matching the guard that **prevents** live keys from being used outside
production, and the spec prose describing that guard:

```
+  const isLiveKey = secretKey.startsWith("sk_live_");
+      "STRIPE_SECRET_KEY is a live key (sk_live_) in non-production environment..."
```

That is safety code being flagged as a leaked credential. Any future Stripe work trips it.

*A type error is masking a frozen-test defect here too* — though a much smaller one than on #96.
Verified, with the branch's own lockfile installed: correcting the API version makes `tsc` exit
clean and takes the acceptance suite to **28 passed, 1 failed of 29**. The one remaining failure is
unsatisfiable by any implementation:

```
FAIL tests/acceptance/216.test.tsx:126 > documents or adds columns for Stripe Connect onboarding state
Error: EISDIR: illegal operation on a directory, read
      const files = readFileSync(migrationsDir, "utf8");
```

It calls `readFileSync` on `supabase/migrations`, a directory. It wants `readdirSync(...).join("\n")`.

**Fix:**
1. `src/lib/stripe.ts:30` — `apiVersion: "2026-07-29.dahlia"`.
2. Amend the first commit `e224752` to change `tests/acceptance/216.test.tsx:126` from
   `readFileSync(migrationsDir, "utf8")` to `readdirSync(migrationsDir).join("\n")`. Force-push.
3. `ci.yml:138` — require a key body so the prefix alone cannot match: `sk_live_[A-Za-z0-9]{8,}`
   (same for `rk_live_`). Fix this once and it stops recurring across the whole PAY series.
4. `./scripts/factory/resume.sh 216 verify`.

**Effort:** small.
**Confidence:** high — I installed the branch's lockfile, applied the API-version fix, and ran both
the typecheck and the suite.

---

## #219 — PAY-3: Replace TrueLayer pay-by-bank with Stripe Pay by Bank destination charges

**Blocked because:** the gate's typecheck fails on three lines of the **frozen acceptance test** —
`tests/acceptance/219.test.tsx` lines 61, 107 and 341 — each `error TS2345: Argument of type
'Request' is not assignable to parameter of type 'NextRequest'`. The test builds a mock and casts
it `as unknown as Request`, then passes it to a route handler whose signature is `NextRequest`.

**Agent asked:** CI is red on the Engineer's commit — is the failure in its implementation, or in
the acceptance test it may not edit?

**Agent recommended:** read the failing job; if the error names `tests/acceptance/`, no Engineer
re-run can fix it.

**My verdict:** Agree exactly — this is the one ticket in the batch where the heuristic works
cleanly and the recommendation is correct as written. Worth going further than the agent could,
though: this item is *finished*. Verified, with the branch's own lockfile installed, the runtime
suite is **30 passed of 30**. The only thing standing between #219 and green CI is a type
annotation in a file the Engineer is forbidden to touch. Nothing about the implementation is in
question, and sending it back to the Engineer — which is what happens if anyone answers (a) — would
be pure waste on a complete item.

**Fix:**
1. Amend `factory/219`'s first commit `2e5ea81`: add `import type { NextRequest } from
   "next/server";` and change `as unknown as Request` to `as unknown as NextRequest` at
   `tests/acceptance/219.test.tsx` lines 61, 107 and 341. Force-push.
2. `./scripts/factory/resume.sh 219 verify`.

**Effort:** trivial.
**Confidence:** high — typecheck errors and the 30/30 runtime pass both reproduced locally.

---

# Do these first

Ordered by unblocked-value ÷ cost.

1. **Merge `main` into `factory/127` and `factory/199`** (~10 min, 2 tickets). Both are invisible to
   CI, not failing it. Nothing about either can be judged until the gate runs once.
2. **#219 — one type cast** (~5 min). The implementation is already 30/30. Also unblocks half of
   #215's dependency.
3. **#216 — API version + `readdirSync` + secret-scan pattern** (~20 min). Goes to 29/29. Completes
   #215's dependency, and step 3 stops the false positive recurring across every PAY ticket.
4. **#96 — delete one directive, fix four test literals** (~15 min). Fully diagnosed and verified.
5. **Raise `--max-turns` and stop discarding over-cap work** (~30 min, #211 + #127 + any future
   large item). This one is infrastructure: it recovers a completed 117-turn implementation that was
   thrown away.
6. **#212 — decide the #211/#212 ordering** (~10 min once decided). Cheapest as "land #211 first".
7. **#215 — resume after 216 and 219 land.** Nothing to do until then.
8. **#170 and #195 — check `FACTORY_TOKEN` has `workflow` scope, then resume.** Cheap to check,
   and it is the one hypothesis that explains both. #170 is also the highest-leverage item in the
   whole queue — see Patterns 1.
9. **#178 and #123 — genuine contract decisions.** Both need you, not an agent. Neither is urgent,
   but both will sit forever until someone answers.

---

# Patterns

**1. Defective frozen acceptance tests are the single largest cause — 7 of 12 items.**
#96 (asserts Capacitor values that do not exist), #216 (`readFileSync` on a directory), #219
(wrong `Request` type), #211 (a regex whose word order the spec never uses), #123 (a local stub
shadowing the module under test, plus five `expect(true).toBe(true)` placeholders), #178
(contradicts its own spec), #215 (16 of 18 assertions test spec prose, so they pass against an empty
branch). The repo already knows: #96's own adjudication says "the fifth item this week blocked by a
defect in the frozen acceptance test rather than the implementation, after #123, #175, #119 and
#127". It is now at least seven.

The freeze is the right rule and the cost of it is landing entirely on the wrong side: the file is
written once, by an agent, with no gate on whether it is satisfiable or whether it observes the
implementation — and then nothing downstream may repair it. **#170 is the fix for this and #170 is
itself blocked** (see Do-these-first 8). Everything else in this document is a symptom; that is the
disease. Two cheap additions in the same area, worth more than any individual unblock:
- Run the acceptance test against the *empty* branch at PM time. Anything that passes before the
  implementation exists is not an acceptance criterion — it would have caught #215's 16 and #123's
  five placeholders.
- Typecheck and lint `tests/acceptance/<n>` in the PM job, before the commit is frozen. That alone
  catches #219 and #216 outright.

**2. A conflicted branch gets no CI at all, and the factory reads the silence as a red gate.**
#127 (`src/app/globals.css`) and #199 (`tests/helpers/capacitor.ts`). GitHub cannot create
`refs/pull/N/merge` for a conflicted PR, so no `pull_request` run is ever created — while Vercel and
GitGuardian keep reporting, because GitHub Apps take the push webhook directly and need no merge
ref. The result is a PR that looks tested and is not. The factory's "CI never reported after 900s"
handler then offers two options (PR closed / CI slow), neither of which is ever the cause. It should
check mergeability and say "the branch conflicts with `main`, merge it" — a two-line `gh pr view
--json mergeable` in the wait loop. Both of these branches conflict in *shared test infrastructure*
that another blocked item also edits, which is its own smell.

**3. The turn cap destroys completed work.** #211 finished the job — clean typecheck, lint, build,
899/900 tests — and the run was failed afterwards for using 117 turns against a cap of 80, with the
push step never reached. #127 "burned two full budgets" per the digest's own note. The cap is
sensible as a runaway guard; enforcing it *after* a successful result and discarding the diff is
not. Commit and push before asserting the cap, and the same incident becomes a resumable branch
instead of four days of nothing.

**4. "If the error names `tests/acceptance/`, it is the test" is right about half the time, and
wrong in the expensive direction.** It works on #219 and #212. It fails on #96, where a single
`TS2578` in `src/` is the *only* thing the gate reports while four frozen-test failures sit behind
it — the rule sends that to the Engineer, which cannot fix it. This is CLAUDE.md's own warning ("a
typecheck failure may be masking worse; fix it, then run the full suite before judging"), and the
generated question does now carry that sentence — but the one-line rule above it contradicts it.
The gate stops at the first error, so the first error is never evidence about the rest. Make the
gate run typecheck, lint and tests with `continue-on-error` and report all four outcomes, and this
class of question answers itself.

**5. Secret-scan false positive on Stripe key prefixes.** `ci.yml:138` matches bare `sk_live_`,
with no key body required, so it fires on the guard that forbids live keys outside production and
on any spec that discusses key handling. It blocked #216 and will block every remaining PAY ticket.
One-character-class fix; do it once.

**6. Cross-item collisions in shared frozen files, with no ordering.** #212's gate fails inside
#152's frozen test; #211 and #212 are both scheduled to delete that same file; #199 and #96 both
edit `tests/helpers/capacitor.ts`; #215 cannot build until #216 and #219 land. The PAY series
(#211/#212/#215/#216/#219) is one migration cut into five tickets that share a file set, sequenced
only by accident. Give that series an explicit order and most of it stops fighting itself.

**7. The digest can surface a stale question indefinitely.** #123's live question ("was this a
transient infrastructure failure?") was composed at 12 Aug 20:12 and superseded 63 minutes later by
the Engineer's `SPEC ERROR` dispute — but the dispute path posts its comment without a
`## DECISION NEEDED` section, so the digest keeps re-publishing the older one. Three mornings running,
#123 has arrived as an answerable question that is not the question. The digest should prefer the
most recent blocking *event*, not the most recent comment that happens to match the heading.

---

## A note on what is not here

I could not determine **why** the Engineer produced no changes on #170 and #195 — that is the one
open gap in this review, and it affects the two items I rated lowest-confidence. The runs report
"produced no changes" rather than an error or a rejected push, so the workflow-scope hypothesis
above is inference from the shape of the deliverable (both are workflow files), not evidence. To
close it I would need the *Implement* step transcripts of runs `31748166935` (#170) and
`31748124257` (#195) — specifically the agent's final `result` text, which the log tail I could
retrieve did not include. That is a five-minute read for someone with the run open, and it would
either confirm the token-scope theory or replace it.
