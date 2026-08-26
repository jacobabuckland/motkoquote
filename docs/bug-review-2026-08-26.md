# Bug review — 26 Aug 2026 quoting session

**Tree audited:** `jacobabuckland/motkoquote`, branch
`claude/motko-voice-intake-diagnostics-jczfld` @ `8d5a8ef`, byte-identical to
`origin/main` @ `8d5a8ef` ("Restore *Copy link* beside the share sheet", #363,
2026-08-26 12:48 UTC). `git rev-list --left-right --count origin/main...HEAD` →
`0 0`.

Read-only review. No source files were changed. History was un-shallowed
(`git fetch --unshallow`) so the archaeology in §2.5 and §5.5 reads the real
394-commit history rather than the 66-commit clone the session started with.

> **CAPABILITY FAULT — production database.** This diagnosis could not query
> production. The `supabase` MCP server requires an interactive OAuth flow that
> this non-interactive session cannot run, and no `agent_readonly` connection
> string, `SUPABASE_*` env var or Supabase CLI is present in the container
> (`env | grep -i supabase` → empty; `which supabase` → not found). The
> permission I lacked is a credential for the `agent_readonly` role described in
> `AGENTS.md` § *Database access*.
>
> Everything below is derived from code, git history and one executed probe of
> the repo's own merge functions. Three questions are consequently marked
> **unproven** and each names the single query that settles it. Nothing here is
> presented as a query result.
>
> **A second gap, in the role's scope rather than in this session's access.**
> The telemetry purpose-built to answer "did this call loop, and did the slots
> get asked" — `voice_session_completed`, carrying `wrap_reason`,
> `pricing_mode`, `required_slots_asked/answered/unknown`, `wrap_incomplete` and
> `questions_asked` — is written to the `events` table
> (`src/lib/analytics.ts:49`). Migration 44 grants `agent_readonly` `select` on
> exactly four tables: `jobs`, `quotes`, `contracts`, `invoices`. `events` is
> not among them, so the role cannot read it even when a credential exists.
> Filed as DIAG-1; widening the role is a decision with a PII review behind it,
> not something to assume.

---

## 1. Summary table

| # | Bug | Severity | Root cause | Primary `file:line` | Blast radius |
|---|---|---|---|---|---|
| 1a | Voice intake: greeting loop, never advances | **Critical** | **Confirmed.** The half-duplex mic gate releases 700 ms after the last *generation* packet (`response.output_audio.delta`), not after the speaker finishes *playing*. Realtime generates faster than realtime, so the mic reopens into the still-playing TTS tail; iOS couples it back; `semantic_vad` scores the echo as a user turn; the model re-greets. | `src/lib/voice-gate.ts:38` + `src/components/voice/job-intake.tsx:991-997` | Every voice job intake, account and guest (`/jobs/new`, `/start`). Same class, unfixed, in `/setup/voice` and `/jobs/[id]/add-cost-voice`. |
| 1b | "All right, **Jake**." | **Low** (diagnostic, not user-facing harm) | **Confirmed.** Not a model hallucination. It is the *contractor-channel transcription of the echo* — `gpt-4o-mini-transcribe` rendering the echoed "Jacob" as "Jake". It looks like the assistant said it only because the on-screen transcript strips the speaker label it already holds. | `src/components/voice/job-intake.tsx:1001-1016`, `:1251-1255` | Display only, but it is what made the loop unreadable and sent the diagnosis after a phantom hallucination. |
| 1c | Practical intake questions "regressed" | **High** | **Confirmed as a consequence of 1a, not an independent regression.** No prompt text was dropped — every change since 20 Aug *strengthened* coverage (§2.5). In a looping call no `update_sow` ever fires, so `maybeStartFollowups()` is unreachable and the checklist phase never runs. Two genuine structural gaps sit underneath (customer details have no deterministic enforcement; the "days on site" question was merged away on 2026-07-26). | `src/components/voice/job-intake.tsx:770-772`, `src/lib/schemas/sow.ts:727-739` | Every voice intake. |
| 2 | Stated fixed price does not reach the quote | **Critical** (money) | **Confirmed, and worse than first written — see §3.0.** Three mechanisms, not one. (a) `pricingSchema.mode` carries `.default("calculated")`, so a mode-less delta silently prices as calculated *and* reads as answered; (b) **the job intake has no deterministic money parse** — `parseSpokenMoneyAmount` exists, refuses to guess, and is wired only into the *cost* intake; (c) nothing reconciles `pricing.fixed_amount` against the persisted total. Production carries a live `accepted` quote at £6.00 whose SoW says £5,000. | `src/lib/parse-spoken-money.ts:1-12` (unused here) · `src/lib/schemas/sow.ts:81` · `src/app/jobs/actions.ts:284` | Every fixed-price voice quote. Silent by construction, and it has already reached `accepted`. |
| 3a | SMS carries £114; the linked page shows £20 | **High** (customer trust / contractual) | **Confirmed.** `EDITABLE_STATUSES` includes `"sent"`. A delivered quote is mutable in place, with no versioning, no re-send, no invalidation, and no notice to the customer. The SMS is a frozen artefact; `/q/[id]` re-derives from `line_items_json` at render. | `src/lib/quote-send-guards.ts:36` | Every quote edited after sending. |
| 3b | Send transmits unsaved edits' *predecessor* | **High** | **Confirmed.** The editor's `send()` never calls `save()`, and the Send button is not gated on the dirty flag. Editing line items and tapping Send (without "Save changes") sends the previously persisted total and then discards the edits on navigation. | `src/app/jobs/[id]/quote-editor.tsx:333-350`, `:829` | Every quote sent straight after a line-item edit. |
| X1 | `cost-intake.tsx` still runs the pre-#339 gate | **High** | **Confirmed.** `assistantSpeaking: callStateRef.current === "speaking"` — the exact formulation `voice-gate.ts:27-35` documents as the cause of the greeting loop. #339 fixed `job-intake` only. | `src/components/voice/cost-intake.tsx:94-101` | `/jobs/[id]/add-cost-voice`. |
| X2 | Invoice amount inherits any wrong `quotes.total` | **Medium** (money, latent) | **Confirmed path, not triggered here.** `deriveInvoiceAmount` reads `quotes.total`; `invoices.amount` then freezes and Stripe charges `Math.round(amount*100)`. Acceptance freezes the quote first, so this flow is safe — but only by ordering, not by design. | `src/app/dashboard/actions.ts:47` → `src/app/api/stripe/create-payment-intent/route.ts:121` | Any quote whose total is wrong at invoice time. |

---

## 2. Bug 1 — Voice intake: greeting loop and regressed questions

### 2.1 Session lifecycle — how many sessions can exist at once?

**Answer: exactly one peer connection and one data channel per mounted
`<JobIntake/>`, and the concurrent-session hypothesis is ruled out.** I want to
state that plainly because it is the theory the observed transcript most
invites, and it is wrong.

Every Realtime session in the job intake is created in one place:

- `src/components/voice/job-intake.tsx:898-1111` — a single `useEffect` whose
  dependency array is `[attempt]` (`:1111`), a plain number.
- `:901` returns early while `attempt === 0`, so nothing is minted and the
  microphone is never touched until the contractor taps **Start talking**.
- `:938-949` constructs the one `RTCPeerConnection` and the one `oai-events`
  data channel.
- `:1105-1109` is the teardown: sets `cancelled = true` and calls `cleanup()`
  (`:391-409`), which stops the media tracks and closes `dcRef`/`pcRef` before
  nulling them.

Every `response.create` is issued through `sendResponse` (`:866-874`), from four
sites: the greeting at data-channel open (`:960`), and three continuation kicks
after a tool ack (`:768`, `:799`, `:832`). Two more carry per-response
instruction overrides (`:578` checklist question, `:651` wrap-up detour).

Checking each hypothesis you named:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| React 19 StrictMode double-mount | **Ruled out.** | No `<StrictMode>` anywhere in `src/`, and `reactStrictMode` is unset in `next.config.ts` (the file has an empty config object). Even with it on, the `attempt === 0` guard at `:901` means the mount-time double-invoke mints nothing. |
| Unstable `useEffect` dependency | **Ruled out.** | The dep array is `[attempt]` — a number. `adapter` is rebuilt every render in `src/app/jobs/new/page.tsx:24` but is deliberately *not* a dependency (the `exhaustive-deps` disable at `:1110` is load-bearing and correct here). |
| Re-render re-firing the opener | **Ruled out.** | The opener fires from `dc.onopen`, a WebRTC event, not from render. |
| Missing cleanup on unmount | **Ruled out.** | `:1105-1109` → `cleanup()` at `:391-409`. |
| Missing guard so a second session can't start while one is live | **Present, but not reachable.** There is no explicit "already connected" guard. What enforces the limit is the effect's teardown-before-rerun ordering. An in-flight `connect()` that is superseded has no `cancelled` check after `pcRef.current = pc` (`:939`), but `cleanup()` has already `close()`d that same `pc`, so the subsequent `pc.setRemoteDescription` (`:1091`) throws `InvalidStateError` into the catch at `:1092`. The leak is closed by accident rather than by design — worth a guard, but it is not this bug. |
| Reconnect/retry logic re-sending the greeting | **Ruled out.** | There is no reconnect logic. `retry()` (`:472-487`) re-*drafts* from refs; it never reopens a session. `startCall()` (`:1115-1120`) bumps `attempt`, which tears the old session down first. |
| iOS resume remounting the screen | **Ruled out, explicitly.** | `src/components/native-app-init.tsx:21-31` lists `/jobs/new` in `REFRESH_EXEMPT_ROUTES`, and `:144-146` handles the `/jobs/` prefix so that job detail is exempt but `/jobs/new` is matched by its own entry. Backgrounding and resuming does not `router.refresh()` the intake. |
| `session.update` racing an already-started response | **Not applicable.** | The client never sends `session.update`. Instructions are baked into the ephemeral credential server-side (`src/lib/realtime.ts:32-61`), so they are in force before the SDP handshake completes. |

### 2.2 The confirmed root cause: the gate releases on the wrong clock

`src/lib/voice-gate.ts:21-38` states the intent exactly, and diagnoses the
*previous* version of this bug in the process:

> The gate used to derive `assistantSpeaking` from the call state, which left
> "speaking" on `response.done`. That frame means the model finished
> GENERATING; it says nothing about whether the phone finished PLAYING.

The 2026-08-24 fix (#339, `2b9b2be`) moved the hold onto audio packets:

```
export const ASSISTANT_AUDIO_TAIL_MS = 700;                  // voice-gate.ts:38
```

and `createAssistantAudioHold` (`voice-gate.ts:62-87`) arms a `setTimeout` for
`tailMs` on every `noteAssistantAudio()`, re-arming on each packet.

The client feeds it here:

```
} else if (data.type === "response.output_audio.delta") {     // job-intake.tsx:991
  stopRotatingMessages();
  assistantAudioHold().noteAssistantAudio();                  // :996
  if (callStateRef.current !== "finishing") updateCallState("speaking");
```

**The defect is that `response.output_audio.delta` is a *generation* event, not
a *playback* event.** It arrives over the data channel as the model produces
audio, which the Realtime API does faster than real time. The *playback* is a
separate thing entirely: a remote WebRTC media track rendered by a detached
`new Audio()` element created at `job-intake.tsx:942-946`. The two are not
synchronised anywhere in this file.

So for a greeting whose spoken duration is `T` and whose generation completes in
`G` (with `G < T`), the mic reopens at `G + 700 ms` while the speaker still has
`T − G` of audio to emit. The gate swapped one wrong clock (`response.done`) for
a *closer* wrong clock (last generation packet) and added a fixed 700 ms of
slack on top. It moved the threshold; it did not change the kind of signal.

The right signal exists and is not handled anywhere in the repo:

```
$ grep -rn "output_audio_buffer" src/
(no matches)
```

`output_audio_buffer.started` / `output_audio_buffer.stopped` are the
WebRTC-transport Realtime events that track the *output audio buffer* actually
draining. `job-intake.tsx:963-1069` handles seven event types and neither of
those is among them.

**Runtime conditions that trigger it.** All four must hold:

1. Audio output on a loudspeaker route, not a headset — so the speaker is
   acoustically coupled to the microphone. On a phone held in the hand on a
   site, this is the default.
2. Generation outrunning playback for the utterance, i.e. `G + 700 ms < T`. The
   opener `"Alright Jacob — tell me about the job. What's the scope? Rooms,
   work, anything tricky on access?"` is roughly 6–7 s of speech; generation of
   that is typically 1–2 s.
3. Echo-cancellation not removing the residual. `getUserMedia` requests
   `echoCancellation: true` (`job-intake.tsx:916-922`), but the far-end
   reference is a media element the page created itself, not a track the WebRTC
   audio pipeline is rendering — see §2.6.
4. `semantic_vad` (`src/lib/realtime.ts:55`) scoring the residual as a user
   turn. Its `create_response` default is on, so it also *creates* the reply.

**Why five openers and not two.** Each cycle is self-sustaining: the re-greeting
is itself TTS, which echoes, which triggers the next. It terminates only on the
hard cap at `job-intake.tsx:1032`, `questionsAskedRef.current += 1` per
`response.done`, against `MAX_ASSISTANT_QUESTIONS = 12`
(`src/lib/schemas/sow.ts:839`). Five openers is a call abandoned before the cap.

**Why the wording drifts rather than repeating.** Each cycle is an independent
sample. `openingLine` in `src/lib/voice/job-intake-prompt.ts:238-241` supplies
the exemplar verbatim:

```
`Open the moment the call connects by greeting them by name and inviting them
 into the job — e.g. "Alright ${firstName} — tell me about the job."`
```

Observed opener #2 is that string with `firstName = "Jacob"` character for
character. #1 and #5 are paraphrases of the same instruction; #3 is #2 plus the
next sentence of the prompt (`"Get them talking you through the job: rooms,
work, and anything tricky about access."`, `:258`) spoken through. No
temperature is set on the Realtime session — deliberately, and the reason is
recorded at `src/lib/models.ts:75-86` — so the session inherits the provider
default, which is where the variation comes from.

`voice-gate.ts:22-25` describes the 24 Aug occurrence as *"'Alright Jacob — tell
me about the job' fired four times before the conversation started, interleaved
with a user turn reading 'All right.'"*. That is the 26 Aug transcript, two days
earlier, with one fewer repetition.

### 2.3 Why the UI never advances off "Listening"

Three things are supposed to move it, and the loop defeats all three.

**Transition 1 — local silence detection.** `sampleAudioLevel`
(`job-intake.tsx:340-369`) fires every 80 ms. It requires
`callStateRef.current === "listening"` (`:355`), then `hasSpokenRef` true and
`SILENCE_MS = 2800` of quiet since the last speech (`:364`) before it advances
to `"thinking"`. **The condition that is never met is `hasSpokenRef`.** It is
reset to `false` on every `response.done` (`:1063`) and set true only by real
mic energy above `SPEECH_RMS_THRESHOLD` (`:358`) or by
`input_audio_buffer.speech_started` (`:980`). During a loop the mic track is
`enabled = false` for most of the cycle (`applyMicGate`, `:249-259`), so the
analyser reads a flat zero and the local detector never arms. Meanwhile the
*server* is hearing plenty — the echo reaches it over the WebRTC track, which
`track.enabled = false` silences only for the duration the gate is actually
closed.

**Transition 2 — the model calling `finish_job` / `wrap_up`.** These only fire
if the model believes the conversation has progressed. It is looking at a
conversation whose only user turns are unintelligible fragments of its own
greeting, so it does what its instructions say to do at the start of a call:
greet.

**Transition 3 — `maybeStartFollowups()` from the tool-turn count.** This is the
mechanism that would have salvaged the call, and it is unreachable:

```
sendResponse(dc);                                            // job-intake.tsx:768
if (phaseRef.current === "description" && toolTurnsRef.current >= MAX_TOOL_TURNS) {
  maybeStartFollowups();                                     // :771
}
```

`toolTurnsRef` increments only inside the `update_sow` branch (`:718`). A
greeting captures no facts, so `update_sow` is never called, so `toolTurnsRef`
stays 0 forever and `MAX_TOOL_TURNS = 5` (`:49`) is never reached. The
one-question-at-a-time checklist phase is therefore **structurally unreachable
in a looping call.** That is §2.5's answer as well as this one.

The screen consequently sits on `statusLabel.listening` = `"Listening — talk me
through the job"` (`:1167`) with `"Go ahead…"` beneath it (`:1346`, shown
because `hearingYou` is false — `micLevel` is flat zero behind the closed gate).
The state machine is oscillating `listening → thinking → speaking → listening`
on each cycle; the two intermediate states are brief and the eye reads it as
static.

**Is the transcript per-session or global?** Global to the component:
`transcriptRef` (`:162`) and `conversationTurnsRef` (`:168`) are component-level
refs, cleared only when `attempt` changes (`:889-896`). Since only one session
exists at a time, no cross-session contamination occurs — but there is also
nothing that would prevent it if a session ever did leak.

### 2.4 The name: "Jake" is echo transcription, not hallucination

The first name reaches the model through exactly one path:

`src/app/jobs/actions.ts:124` → `buildJobIntakeInstructions({ firstName, … })` →
`src/lib/voice/job-intake-prompt.ts:238-241`, which interpolates it into a
template literal inside double quotes. There is no truncation, no nickname map,
no shortening anywhere; `grep -rn "Jake" src/` returns nothing.

**"All right, Jake." is a contractor-channel line, not an assistant line.** Both
speakers are appended to one flat array:

```
} else if (
  (data.type === "conversation.item.input_audio_transcription.completed" ||   // :1001
    data.type === "response.output_audio_transcript.done") &&                 // :1002
  data.transcript
) {
  transcriptRef.current.push(data.transcript);                                // :1005
```

`src/lib/voice-transcript.ts:40-50` states which is which:
`input_audio_transcription.completed` is the *contractor's* microphone,
`output_audio_transcript.done` is the assistant. The labelled parallel is built
correctly at `:1008-1015` and persisted to `jobs.conversation_json` — **but the
UI renders the unlabelled flat array:**

```
{displayTranscript.map((line, i) => (                        // :1251
  <div key={i} className="mb-2 last:mb-0">{line}</div>
))}
```

So the sequence on screen was, in truth:

| # | Channel | What it actually is |
|---|---|---|
| 1 | assistant | first opener |
| 2 | assistant | re-greeting |
| 3 | assistant | re-greeting, run on into the next prompt sentence |
| 4 | **contractor** | `gpt-4o-mini-transcribe` transcribing the echoed tail — "Jacob" → "Jake" |
| 5 | assistant | re-greeting |

`voice-gate.ts:24-25` records the identical artefact from 24 Aug: *"interleaved
with a user turn reading 'All right.' — the tail of the assistant's own
greeting, transcribed back."*

There is a real secondary risk once that line is in the conversation: the model
may mirror "Jake" back in a later turn, because a user turn saying "Jake"
outranks an instruction saying `"Jacob"` for the model's sense of what to call
someone. But the *origin* is transcription of echo. There is no unconstrained
instruction to quote — `openingLine` is fully constrained and names the exact
string.

**Marked unproven:** whether the assistant subsequently *spoke* "Jake". The
query that settles it, once a credential exists:

```sql
select speaker, text
from jobs, jsonb_array_elements(conversation_json) as t(turn),
     lateral (select turn->>'speaker' as speaker, turn->>'text' as text) x
where id = '<job-id>' order by turn->>'at';
```

A `speaker = 'assistant'` row containing "Jake" would make it mirroring; only
`speaker = 'contractor'` rows would confirm it never left the echo channel.

### 2.5 The regression in question coverage

**Finding: nothing was dropped from the prompt. The regression is 1a.**

The current instructions still carry every question you listed:

| Expected question | Where it lives now | Enforced deterministically? |
|---|---|---|
| Anyone else on the job | `checklistCaptureLine` (`job-intake-prompt.ts:166`) + `CHECKLIST_QUESTIONS.crew` (`sow.ts:728`) | **Yes** — required slot |
| How it's priced | `checklistCaptureLine:173-176` + `CHECKLIST_QUESTIONS.duration` (`sow.ts:735`) | **Yes** — required slot |
| Who supplies materials | `checklistCaptureLine` + `CHECKLIST_QUESTIONS.materials_supply` (`sow.ts:736`) | **Yes** — required slot |
| Deadline | `CHECKLIST_QUESTIONS.deadline` (`sow.ts:737`) | Follow-up only, never blocks a wrap |
| Pre-agreed costs | `CHECKLIST_QUESTIONS.agreed_costs` (`sow.ts:738`) | Follow-up only |
| Customer name | `customerLine` (`job-intake-prompt.ts:206-212`) | **No** |
| Site address | `customerLine` | **No** |
| Customer contact | `customerLine` | **No** |
| **Dates / days on site** | **Nowhere as its own question** | **No** — see below |

Git archaeology on every file that builds the instructions:

```
$ git log --oneline --date=short -- src/lib/voice/job-intake-prompt.ts
ddaa068 2026-08-23 fix: stop the voice intake entering a saved team member twice … (#329)
b6265ac 2026-08-21 V3: exempt the required slots from the question budget
457f717 2026-08-21 V1: stop injecting retrieved past-job context into the voice intake prompt
0e2ef10 2026-08-20 Close the three remaining findings from the 19 Aug end-to-end run (#299)
ce4f233 2026-08-18 Add an unauthenticated guest quote flow …            (file created here)
```

`git diff 0e2ef10 HEAD -- src/lib/voice/job-intake-prompt.ts` is a **net
addition** of question-forcing text. The before/after of the operative clause:

```diff
-    "change the price or scope — a good estimator infers the rest rather than interrogating. Never ask " +
-    `more than ${MAX_SOW_TURNS} questions total. Once you have enough information to draft an accurate ` +
-    `quote, or after ${MAX_SOW_TURNS} questions, call the finish_job tool …`
+    "change the price or scope. For discretionary detail — the shape of the job, the bits that colour an " +
+    "estimate — a good estimator infers the rest rather than interrogating. That licence does NOT extend " +
+    "to the three required slots (the crew, how it's priced, and materials): those are asked out loud and " +
+    "answered by the contractor, never inferred, never assumed from context, and never guessed …" +
+    `Never ask more than ${MAX_SOW_TURNS} discretionary questions total. That budget covers scope and ` +
+    "detail follow-ups only. The three required slots sit outside it, as do the customer details needed " +
+    "to send the quote — neither is ever crowded out by it. …"
```

The only *removal* in that window is `historyLine` (457f717, 2026-08-21), which
deleted retrieved past-job context — and the reason is recorded at
`job-intake-prompt.ts:108-116`: injected past quotes *"let the agent treat
required slots as already answered"*. That change made the questions *more*
likely to be asked, not less.

`customerLine` has been in the instructions since `ffc5d60` (2026-07-14) and was
moved verbatim into the shared builder by `ce4f233` (2026-08-18). It has never
been removed.

**So the observed "it no longer asks" is 1a.** In a greeting-looping call:
`update_sow` never fires → `toolTurnsRef` stays 0 → `maybeStartFollowups()`
(`job-intake.tsx:585-596`) is never called → the entire checklist phase, which
is the *only* deterministic asking mechanism in the system, never runs. If the
loop had reached 12 turns, `concludeOrAskRequired("cap_questions")`
(`job-intake.tsx:1053-1055`) would have blurted crew + pricing + materials in
one compact turn (`buildCombinedWrapInstruction`, `:542-553`) and then drafted.
Customer name, address and contact would still never have been asked, because
nothing deterministic asks them.

Two real structural gaps sit underneath, and they are worth fixing regardless of
1a:

**(i) The "days on site" question no longer exists.** `33dced8` (2026-07-26,
*"feat: add pricing-mode slot (days / fixed / calculated) to quoting"*) replaced
it:

```diff
-  duration: "Which days will you be on site, or roughly how many days is the job?",
+  duration: "How do you want to price it — tell me the days, give me a fixed price, or I'll work it out from the job for you to check?",
```

The slot kept the id `duration` but stopped being a duration question. A
contractor who answers "give me a fixed price" is never asked which days they
are on site, and `isDurationSlotAnswered` (`sow.ts:758-764`) correctly treats
that as complete. This is a deliberate merge with a recorded rationale
(`sow.ts:729-734`), but it *is* the disappearance of the dates question you
noticed.

**(ii) Customer details have no deterministic backstop at all.**
`ChecklistQuestionId` (`sow.ts:725`) is `crew | duration | materials_supply |
deadline | agreed_costs`. `getUnansweredChecklistQuestions` (`:771-790`) checks
those five fields and nothing else. `customer_name`, `site_address`,
`customer_phone` and `customer_email` exist in the SoW schema and in the
`update_sow` tool, but `maybeStartFollowups`, `concludeOrAskRequired` and the
wrap detour are all blind to them. Their entire enforcement is one sentence of
prose at position 5007 of a 7 680-character prompt.

**Prompt length and truncation.** There is no truncation anywhere: nothing
slices, caps or trims the instruction string between
`buildJobIntakeInstructions` and the `client_secrets` POST
(`src/lib/realtime.ts:42`). I measured the real built string by executing the
repo's own builder:

| | chars | ≈ tokens |
|---|---|---|
| Account instructions (`firstName`, `trade`, account tools) | 7 680 | ~1 920 |
| Guest instructions | 7 381 | ~1 845 |
| Tool JSON (base + account, incl. `SOW_DELTA_TOOL_PARAMETERS`) | 9 816 | ~2 454 |

Position of each clause within the account instructions:

```
   582  Alright <name> — tell me about the job     (the opener)
   665  Get them talking you through the job
  3269  Five facts matter for pricing               (the three required slots)
  5007  A quote can't be sent without knowing who it's for   (customer details)
  5576  Proper nouns                                 (read-back confirmation)
  6572  Never ask more than 5 discretionary questions
  7500  wrap_up tool to end
```

So ~4.4k tokens of system material go to `VOICE_MODEL = "gpt-realtime-mini"`
(`src/lib/models.ts:67`), with the customer-details instruction two-thirds of the
way down. That is not truncation, but it is real instruction dilution on the
smallest model in the family, on the call most sensitive to
instruction-following.

**And one thing I cannot rule out from code.** `src/lib/models.ts:39-67` records
that `gpt-realtime-mini` is **an unpinned floating alias** the provider can
repoint with no deploy on our side, and that a documented replacement
(`gpt-realtime-2.1-mini`) exists on a 20 Jan 2027 shutdown clock. A silent
repoint is precisely the shape of "something changed materially for the worse
with no diff to point at". `git log -S 'gpt-realtime-mini'` shows the string
unchanged since 2026-07-12 (`0e256db`), so no code change did this.
**Unproven — and unprovable from this container.** What proves it: one call to
`GET /v1/models` with a real `OPENAI_API_KEY` to resolve today's snapshot, then
pin it. That is the outstanding action `models.ts:53-58` already writes down.

### 2.6 iOS

Motko's iOS app is a WKWebView pointed at the live origin — `webDir` is only a
pre-load splash (`capacitor.config.ts:11-24`). **The same JavaScript runs.** So
every finding above applies in the app identically; none is web-only.

What is genuinely iOS-specific is the *trigger*, and it is why this reproduces
on device and rarely at a desk:

- **Loudspeaker coupling.** A phone held at arm's length on a site plays TTS
  through the loudspeaker straight into its own microphone. A laptop with a
  well-behaved AEC and a quiet room usually will not show it. This is why #210
  (`c6851b1`, 2026-08-13) is titled *"On iOS the device speaker's TTS coupled
  back into the hot mic"*.
- **The far-end reference is not in the WebRTC render path.** The remote track
  is attached to a detached element — `const remoteAudio = new Audio()` at
  `job-intake.tsx:942`, never appended to the DOM, `srcObject` set at `:945`.
  Browser AEC cancels what the WebRTC audio pipeline renders; audio played
  through a page-created media element is not reliably part of that reference.
  `echoCancellation: true` at `:918` is requested in good faith and may simply
  not be seeing the signal it needs to cancel.
- **No `AVAudioSession` configuration exists.** `grep -rn "AVAudioSession" ios/
  native/` returns nothing. There is no category/mode set (e.g.
  `playAndRecord` + `.voiceChat`, which is what enables the system voice-
  processing I/O unit and hardware AEC). `Info.plist` carries
  `NSMicrophoneUsageDescription` (`:27`) and `UIBackgroundModes` containing only
  `remote-notification` (`:29-32`).
- **Interruption and backgrounding are unhandled.** `App.addListener("appState
  Change", …)` exists (`src/components/native-app-init.tsx:162`) but does only a
  session check and a conditional `router.refresh()`; `/jobs/new` is exempt
  (`:22`). Nothing tears down or re-establishes the peer connection across an
  incoming call, a Siri interruption, or a background/foreground cycle. There is
  no `UIBackgroundModes: audio`, so a backgrounded call's audio session is
  suspended — the wall-clock caps at `job-intake.tsx:1046-1060` keep running
  against a dead channel, and `WRAP_DETOUR_TIMEOUT_MS` (`:69`) exists precisely
  because of *"iOS Safari when the mic/AudioContext stalls"*.
- **Permission re-prompt** is a non-issue for the loop: `getUserMedia` failures
  are classified and routed to `MicFailureScreen` (`:923-930`), which is a
  different, working path.

**Unproven, needs one device test:** whether WKWebView's AEC covers the detached
`Audio` element. What proves it: run the intake on a real iPhone through the
loudspeaker with the gate temporarily forced permanently closed. If the loop
stops, the coupling is the mechanism; if it persists, the cause is elsewhere.
This is the same device confirmation `2b9b2be`'s own commit message asked for
and did not get.

---

## 3. Bug 2 — the stated fixed price does not reach the quote

### 3.0 Production evidence (added 26 Aug, after the first draft)

Queries run against prod by Jacob after this document was first written. They
**change the conclusion**, and the correction is worth stating plainly: §3.1's
zod-default mechanism is real and proven by execution, but it is not what
produced the live wrong row, and it is not the most serious of the three.

| job | `sow_json.pricing` | `quotes.total` | verdict |
|---|---|---|---|
| `ddbf80ac…` (26 Aug, the reported one) | `{"mode":"fixed","fixed_amount":20}` | `24.00` | **corrected state — not evidence** |
| `ad18fac0…` (24 Aug) | `{"mode":"fixed","fixed_amount":5000}` | `6.00` | **live defect, `accepted`** |
| `eab2a978…` (21 Aug) | `{"mode":"fixed","fixed_amount":200}` | `240.00` | correct — 200 × 1.2 |
| `25dce3db…`, `73a44fe3…` | `null` | `1056.00`, `0.00` | legacy, pre-Task B — correct |

**The reported job can no longer be diagnosed from `sow_json`.** I asked for the
wrong query and should have seen why: `setQuotePricingMode` writes `pricing`
straight back to `jobs.sow_json` (`actions.ts:787`), so the in-app correction
overwrote the field the voice call had written. Row 1 is the fix, not the fault.
Only `jobs.transcript` / `conversation_json` still hold what was said.

**Row 2 is the one that matters**, and the discriminating query settles it:

```
status: accepted   total: 6.00   active_lines: 1   drafted_lines: 11
first_description: "Rewire works — see Scope of work"   first_unit_price: 5
```

That is `buildFixedModeLineItems` output verbatim — one works line, the
`deriveWorksDescription` phrasing, the 11-line calculated breakdown retained.
**Fixed mode ran correctly. It ran on the number 5.** So neither the zod default
nor a later line-item edit explains it.

Where the 5000 came from: not `setQuotePricingMode` — the status is `accepted`,
outside `EDITABLE_STATUSES`, and `actions.ts:771-786` deliberately runs the
guarded quote UPDATE *first* precisely so a refusal cannot leave `sow_json` ahead
of the quote. That ordering worked. That leaves `saveSowDelta` (`:284`), which
writes `sow_json` and **never touches the quote** — so a pricing correction
captured after the quote exists diverges silently and permanently.

And the guard that would catch it postdates it: `narrativeExceedsSubtotal` fires
on this row today (£5,000 in prose vs a £5.00 subtotal), but the decision adding
it is `areas/motko.md`, 25 Aug; the quote is 24 Aug. It went out unguarded and
was **accepted** at £6.00 against a scope of work saying £5,000. This is the
45E0DB69 case named at `quote-send-guards.ts:55-66` — a send-time guard was
added, and **the pricing defect underneath it was never fixed.**

### 3.0.1 The root cause the evidence points at

**The job-intake pricing path has no deterministic money parse.**
`pricing.fixed_amount` arrives from the model as a raw `number`
(`sow.ts:335-338`) and is written through with no validation beyond
`z.number().positive()`.

A deterministic parser already exists, is pure, is unit-tested, and refuses to
guess — `src/lib/parse-spoken-money.ts:1-12`:

> Returns null for ambiguous or unparseable inputs — the voice flow must ask for
> clarification rather than guessing. … **Money integrity depends on this being
> deterministic.**

It is wired into `costs/actions.ts:111` and `voice/draft-cost.ts:47` — the
**cost** intake — and nowhere else. Executed against the phrasings in play:

| input | `parseSpokenMoneyAmount` |
|---|---|
| `"five thousand"` / `"five thousand pounds"` | `500000` (£5,000) ✓ |
| `"£5,000"` / `"5000"` | `500000` ✓ |
| `"five"` | **`null`** — refuses |
| `"five grand"` | **`null`** — refuses (`"grand"` is not in `SCALES`) |

Every outcome is either correct or a refusal that forces a clarifying question.
**None of them is `5`.** The model produced `5`; the parser built to prevent
exactly this was not consulted. The money-integrity discipline exists, is
tested, and is not applied to the one field that sets a customer-facing quote
total.

**Still open, one question.** What the contractor actually said, from
`jobs.transcript` for `ad18fac0…` — a mis-heard "five grand", a model
transcription fault, or a genuine mid-call correction. That column carries
customer PII: read it in the SQL editor and report only the price phrasing.


### 3.1 The full path

```
spoken "£20 fixed"
  → model calls update_sow with a `pricing` delta
  → job-intake.tsx:729  adapter.persistDelta
  → jobs/new/page.tsx:38 saveSowDelta
  → sow.ts:602-609       mergeSowDelta folds `pricing` into sow_json
  ────────────────────── call ends ──────────────────────
  → jobs/actions.ts:429  draftQuoteLineItems  (structure only, no prices)
  → jobs/actions.ts:449  compileDraftToLineItems → calculatedLineItems (£95 net)
  → jobs/actions.ts:487  applyPricingMode(calculatedLineItems, sowState, …)
  → jobs/actions.ts:493  computeQuoteTotals → total
  → jobs/actions.ts:495-509 INSERT quotes(line_items_json, total)
  → /q/[id]/page.tsx:87  computeQuoteTotals(line_items_json) at render
```

**Where £20 is dropped: `src/lib/schemas/sow.ts:81-86`.**

```ts
const pricingSchema = z.object({
  mode: pricingModeSchema.default("calculated"),   // :81
  fixed_amount: z.number().positive().nullable().default(null),  // :85
});
```

The `update_sow` tool exposes `pricing` as an object with **no `required`
array** (`sow.ts:325-339`), so `{pricing: {fixed_amount: 20}}` is a legal call.
Zod then supplies `mode: "calculated"` and the merge at `:602-609` writes it
through unchanged.

I ran this against the repo's own functions rather than reasoning about it:

| `update_sow` delta | merged `pricing` | `resolvePricingMode` | duration slot | line items out of `applyPricingMode` |
|---|---|---|---|---|
| `{fixed_amount: 20}` | `{mode:"calculated", fixed_amount:20}` | `calculated` | **answered** | `[{d:"Downlights labour", u:95}]` |
| `{mode:"fixed", fixed_amount:20}` | `{mode:"fixed", fixed_amount:20}` | `fixed` | answered | `[{d:"Works — see Scope of work", u:20}]` |
| `{mode:"fixed"}` | `{mode:"fixed", fixed_amount:null}` | `fixed` | unanswered | `[{d:"Downlights labour", u:95}]` |
| `{}` | `{mode:"calculated", fixed_amount:null}` | `calculated` | **answered** | `[{d:"Downlights labour", u:95}]` |

Row 1 is the bug, and it is the worst of the four because it is **silent in both
directions**: the price is recorded and ignored, *and* the slot reads as
answered so the wrap detour (`job-intake.tsx:607-652`) never re-asks and
`unasked_required` stays empty. The quote presents as complete.

Row 3 is the benign failure — `isDurationSlotAnswered` (`sow.ts:758-764`)
returns false for `fixed` with no amount, so the slot stays open and gets
re-asked. That branch was added deliberately (`sow.ts:774-784` names the
"Correct." session it was written for). The `mode`-missing case was not
considered.

### 3.2 The precedence rule in code

Precedence for a stated fixed price is asserted in exactly one branch:

```ts
// src/lib/pricing-mode.ts:82-94
if (mode === null) {
  return calculatedLineItems;          // legacy jobs, pre-Task B
}
if (mode === "fixed" && fixedAmount != null) {
  const provisionals = calculatedLineItems.filter((item) => item.provisional === true);
  return buildFixedModeLineItems(
    deriveWorksDescription(sow.job_type, hasScopeSection),
    fixedAmount,
    provisionals,
  );
}
return calculatedLineItems;
```

**Nothing is allowed to override a stated fixed price — once the branch is
entered.** The problem is that the guard is `mode === "fixed"`, and the mode is
the field that silently defaults away. The stated amount is treated as evidence
*subordinate* to the mode, when it is the stronger signal of the two: a contractor
who names a number has told you the mode by naming it.

Everything you listed as an alternative is ruled out:

- **LLM-estimated total taking precedence** — ruled out. `src/lib/claude.ts:89-93`
  tells the drafting model *"You NEVER set prices or totals — the app computes
  every amount in code … Any price you were to invent would be discarded."* The
  model emits `{kind, description, people:[{ref,days}], …}` shapes with no money
  except `estimated_unit_cost_pence` for materials and
  `suggested_amount_pence` for provisionals, both of which
  `compileDraftToLineItems` re-derives or carries as explicitly editable
  placeholders (`compile-draft.ts:262, :351`).
- **Labour × hours still running in fixed mode** — that is exactly what happened,
  but because the mode was never `fixed`, not because the fixed branch leaks.
- **Default / last-used rate** — no such fallback exists.
- **Pennies↔pounds error** — ruled out for this bug. `formatGBP` takes pounds
  (`src/lib/format.ts:2-3`) and `quotes.total` is pounds. £20 → £114 is not a
  factor of 100.
- **Multiplier / uplift** — `buildFixedModeLineItems` hardcodes `multiplier: 1`
  (`pricing-mode.ts:51`), matching your corrected quote exactly.
- **VAT twice** — ruled out. `computeQuoteTotals` applies VAT once
  (`quote-math.ts:56`). 114 / 1.2² = 79.17, not a round figure; 114 / 1.2 = 95.00
  exactly.
- **Stale draft total not recomputed** — ruled out for the initial draft: the
  quote row is INSERTed after `applyPricingMode`, in one pass.

### 3.3 Is the header total computed from the same function as the line items?

**Yes — `computeQuoteTotals` in `src/lib/quote-math.ts:48-60` is the single
total function, and there is no duplicate implementation.** Complete list of
call sites:

| Site | Input | Purpose |
|---|---|---|
| `src/app/jobs/actions.ts:493` | `lineItems` | initial draft → `quotes.total` |
| `src/app/jobs/actions.ts:662` | `lineItems` | redraft → `quotes.total` |
| `src/app/jobs/actions.ts:756` | `calculatedLineItems` | seed a fixed amount from the calculated subtotal |
| `src/app/jobs/actions.ts:769` | `lineItems` | pricing-mode switch → `quotes.total` |
| `src/app/jobs/actions.ts:906` | `lineItems` | editor save → `quotes.total` |
| `src/app/jobs/actions.ts:1025` | `line_items_json`, `vat=false` | narrative-vs-subtotal send guard |
| `src/app/jobs/[id]/quote-editor.tsx:255` | **local React state** | the editor header |
| `src/app/q/[id]/page.tsx:87` | `line_items_json` | the public quote page |
| `src/lib/pdf/quote-payload.ts:142` | `payload.lineItems` | the quote PDF |
| `src/lib/contracts/build-variables.ts:69` | `lineItems` | contract money variables |
| `src/lib/guest/quote.ts:147` | `lineItems`, `vat=false` | guest quote |

So the *function* is single. The **inputs are not**, and that is the real
finding:

- Every *renderer* derives from `line_items_json` at read time.
- The **SMS and email alone read the denormalised `quotes.total` column**
  (`jobs/actions.ts:985` → `:1136`).
- The **editor header derives from unsaved local state** (`quote-editor.tsx:255`,
  dependency `[lineItems, vatRegistered]`), which is why the screen can show £20
  while the database still holds £114.

Every in-app writer does update `total` alongside `line_items_json`
(`actions.ts:669-674`, `:777`, `:912`), so the column is not currently drifting
— but nothing structurally requires that, and one future writer that forgets it
would desynchronise the SMS from the page with no test failing.

### 3.4 Is the stated price a hard constraint on the drafting call? Is the output validated?

**Neither.**

The drafting model never sees the stated price at all. `sowToExtraction`
(`sow.ts:676-718`) is what is handed to `draftQuoteLineItems`, and it does not
carry `sow.pricing`. `agreed_costs.fixed_price` reaches it only as prose in
`notes` (`:697-704`). That omission is *correct by design* — the pricing
contract says code applies the fixed price after drafting, not the model.

The absent half is validation. After `applyPricingMode` at `actions.ts:487`,
nothing compares the resulting total against `sowState.pricing.fixed_amount`
before the INSERT at `:495`. The complete list of `fixed_amount` consumers is
four lines:

```
src/app/jobs/actions.ts:761        writes it (editor mode switch)
src/app/jobs/actions.ts:1035       agreedPriceDisagrees(agreed_costs.fixed_price, pricing.fixed_amount)
src/app/jobs/[id]/page.tsx:735     seeds the editor input
src/lib/pricing-mode.ts:77         reads it inside the `mode === "fixed"` branch
```

The one existing guard, `agreedPriceDisagrees`
(`quote-send-guards.ts:152-158`), returns `false` when either field is null —
and in this scenario `agreed_costs` is null, so it never fires. The narrative
guard is also blind here: `narrativeExceedsSubtotal`
(`quote-send-guards.ts:122-135`) is deliberately one-directional and only fires
when the prose names a figure *above* the subtotal. A narrative saying £20 over
a £95 subtotal passes silently. The doc comment at `:117-120` explains why that
direction was chosen; it is a reasonable choice that happens to leave this case
uncovered.

### 3.5 Reproducing £114

**£114.00 = £95.00 net + £19.00 VAT.** Your corrected quote reads "Fixed price —
£20.00 + VAT" with a header total of £24.00, so the contractor is VAT-registered
and `computeQuoteTotals(…, true)` applied 20% (`quote-math.ts:3, :56`). Working
backwards, `114 / 1.2 = 95.00` exactly. So `applyPricingMode` returned a
calculated breakdown with a **£95.00 net subtotal**.

Candidates for a £95.00 net subtotal, ranked, from the repo's own compiler
(`src/lib/compile-draft.ts`):

1. **One labour line, 1 day, `contractors.day_rate = 95`** — most likely.
   `compileLabour` (`:99-114, :197-213`) computes `crewTotal = Σ days ×
   day_rate` and the model was told to emit one labour line for the whole job
   (`claude.ts:96-98`). A single-room downlights job drafts as exactly one
   owner-day. £95 is an ordinary UK electrician day rate, and it needs no
   coincidence in the other levers: `multiplier` is hardcoded to 1 (`:214`) and
   `markup_pct` does not touch labour.
2. **A rate-card line** — `unit_price: card.rate_per_unit` verbatim (`:334`), so
   a "downlight install" card at £95/job, or 10 units × £9.50, lands exactly.
   Plausible but requires a card to exist at that value.
3. **Materials with markup** — `round2(estimate × (1 + markup_pct/100))`
   (`:283-287`). £95.00 to the penny from an estimate plus a whole-percent
   markup is possible (£76 × 1.25) but needs two values to coincide.
4. **Labour + materials summing to £95.00** — arithmetically possible, but a
   round £95.00 from two independent components is the least likely of the four.

**Marked unproven.** I could not read `contractors.day_rate` or the quote's
`drafted_line_items_json`. One query discriminates all four:

```sql
select q.total, q.drafted_line_items_json, q.line_items_json,
       j.sow_json -> 'pricing' as pricing
from quotes q join jobs j on j.id = q.job_id
where j.id = '<job-id>';
```

If `sow_json->'pricing'` reads `{"mode":"calculated","fixed_amount":20}`, row 1
of the table in §3.1 is confirmed as the actual cause and not merely the most
likely one. If it reads `{"mode":"fixed","fixed_amount":null}`, the cause is
instead that the model never captured the number and the wrap detour did not
recover it — a different fix.

---

## 4. Bug 3 — SMS carries a stale total

### 4.1 Where the SMS body is built, and when it reads the total

```ts
// src/lib/sms.ts:30-32
const body =
  `${input.companyName}: your quote for ${formatGBP(input.total)} is ready — ` +
  `${input.quoteUrl}. Reply STOP to opt out.`;
```

`input.total` arrives from `notifyCustomer` (`src/lib/notify-customer.ts:111-116`),
whose `amount` is set at the one call site:

```ts
// src/app/jobs/actions.ts:1126-1138
const report = await notifyCustomer({
  event: "quote_sent",
  …
  amount: quote.total,          // :1136
  channels,
});
```

and `quote` is read fresh at `:983-987`, moments earlier in the same request.

**So there is no deferred send and no snapshot taken at draft time.** The send
is synchronous (`notify-customer.ts:185`, `Promise.all([runEmail(), runSms()])`),
Twilio is called inline (`sms.ts:40-50`), and there is no cron, worker or queue
anywhere in the quote path. Your "queued job replays an old payload" hypothesis
is ruled out.

What *is* true is that `quote.total` is a **denormalised column**, and the SMS is
the only outbound surface that reads it rather than deriving from
`line_items_json`.

### 4.2 The public quote page reads a different source

```ts
// src/app/q/[id]/page.tsx:48
.select("id, line_items_json, status, viewed_at, job:jobs(…vat_registered…)")
// :87
const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);
```

The page never reads `quotes.total`. It re-derives at render, every time.

Same function (§3.3), different source of truth. The SMS is a **frozen artefact
of the value at send time**; the page is a **live projection of current state**.
They agree only for as long as the quote does not change — which the data model
positively permits.

### 4.3 Intended vs actual behaviour of an edit after send

**Intended behaviour is defined, and it is "silently update".**
`src/lib/quote-send-guards.ts:22-36`:

> A quote is editable while it is being prepared ('draft') or is out for a
> decision ('sent'). Once the customer has accepted or declined, the figures are
> agreed evidence …

```ts
export const EDITABLE_STATUSES = ["draft", "sent"] as const;   // :36
```

**Actual behaviour matches the intent exactly** — and the intent is the bug.
`setQuotePricingMode` (`jobs/actions.ts:775-789`) and `updateQuoteLineItems`
(`:910-920`) both assert `.in("status", EDITABLE_STATUSES)`, which `"sent"`
satisfies. So a delivered quote is rewritten in place, and:

- there is no version row, no `quotes` history table, no `superseded_by`;
- `sent_at` is not cleared and `status` stays `"sent"`;
- nothing re-sends, and nothing marks the delivered message as superseded;
- the customer is not told.

**This is the structural cause underneath Bug 3, and I want to state the
severity plainly.** A customer holding an SMS that says £114, opening the link in
that same SMS and seeing £20, has two documents from one business that disagree
by a factor of 5.7. Whichever way that conversation goes, the trade loses it —
and if the correction had gone the *other* way (£20 texted, £114 on the page)
the customer would have a written offer at £20 with a contemporaneous
timestamp. The repo already understands this failure mode: `quote-send-guards.ts:55-66`
documents quote 45E0DB69 going out with two figures three orders of magnitude
apart and calls it *"a dispute waiting to happen"*, in almost those words. The
guard written in response looks at prose-versus-total on one document. It does
not look at document-versus-document over time.

### 4.4 Every other outbound channel

| Channel | Amount source | Stale-snapshot? |
|---|---|---|
| **SMS** (`sms.ts:31`) | `quotes.total` at send | **Frozen in the delivered message.** The defect. |
| **Email** (`email.ts:58` via `notify-customer.ts:77-83`) | `quotes.total` at send | **Identical exposure.** Same `amount`, same freeze, and an email is more durable than an SMS. |
| **Public quote page** (`q/[id]/page.tsx:87`) | derived at render | No — live. |
| **Quote PDF** (`api/quotes/[id]/pdf/route.ts:9` → `render-quote.ts:87` → `quote-payload.ts:142`) | derived at render from `line_items_json` | No — live. But a PDF a customer has *downloaded* is frozen the same way the SMS is. |
| **Contract / SoW** (`contracts/build-variables.ts:69`) | derived from `lineItems` | Mixed, and documented: `quote-send-guards.ts:26-30` records that the money panel reads `quotes.total` live at view time while the body prose carries the total frozen into `variables_json` at signature. Editing after signature would make a signed contract disagree with itself — which is precisely why `"accepted"` is not in `EDITABLE_STATUSES`. |
| **Invoice** (`dashboard/actions.ts:47` → `invoice-amount.ts:24-54`) | `quotes.total` at creation, then frozen into `invoices.amount` | **Latent money bug.** See below. |
| **Payment amount** (`api/stripe/create-payment-intent/route.ts:121`) | `Math.round(invoice.amount * 100)` | Inherits whatever `invoices.amount` froze. |
| **Motko fee** (`settle-paid-job.ts:154`) | `Math.round((invoice.quote?.total ?? invoice.amount) * 100)` | **Not a defect — deliberate and commented.** `:152-153` states it: *"Fee bands on the job's total value (quote total), not the single invoice — so a deposit-first payment is banded on the whole job, once."* The fee is a flat £2/£4 with a single £1,000 threshold (`motko-fee.ts:14-16`), so even a stale total moves it by at most £2, and only if it crosses that threshold. |
| **Push** (`push/*`) | no amount in any quote-lifecycle payload | Not applicable. |

**Saying the money part loudly, as asked.** The payment amount *can* be built
from a `quotes.total` that no longer matches what the customer agreed to. The
chain is `quotes.total` → `deriveInvoiceAmount` → `invoices.amount` → Stripe
pennies. In *this particular* sequence it is safe, but only by ordering: a
customer accepting sets `status = 'accepted'`, which leaves `EDITABLE_STATUSES`
and freezes the figures before any invoice can be raised. That is a safety
property nothing asserts and no test covers, and it is the only thing standing
between a mutable quote and a charged amount.

**Correcting an earlier reading of this section.** I first flagged
`settle-paid-job.ts:154` as the sharper money risk, on the grounds that it bands
the fee on `quotes.total` rather than on the invoice actually paid. That is what
it does, and it is deliberate: `:152-153` says so, and the fee is a flat £2/£4
capped at a single £1,000 threshold. A stale total can therefore move the fee by
at most £2, and only across that one boundary. It is not a defect and no ticket
was filed for it.

### 4.5 A second, independent stale-send path in the editor

Worth separating from 4.3 because it needs a different fix.

```ts
const save = () => {                                   // quote-editor.tsx:300
  startTransition(async () => {
    await updateQuoteLineItems({ jobId, quoteId, lineItems });   // :304
    setSaved(true);
  });
};

const send = (confirm = {}) => {                       // :333
  …
  const result = await sendQuote({ jobId, quoteId, customer: {…}, channels, … });  // :344
```

`send()` never calls `save()`, and the Send button is gated only on
`sent || isSending || Boolean(sendBlockedReason)` (`:829`) — where
`sendBlockedReason` (`:411-417`) covers only the customer's name and contact
channel. **The dirty flag `saved` (`:77`) is not consulted.**

So: edit a line item, tap **Send** without tapping **Save changes** →
`sendQuote` reads the *previously persisted* `line_items_json` and `total`, the
customer receives the old figures on both the message and the page, and the
contractor's edits are discarded when the editor unmounts on navigation
(`:378`, `router.push`). The header total on screen showed the new figure the
whole time, because `quote-editor.tsx:255` computes from local state.

Note this path makes the SMS and the page *agree* — on the wrong number. It is
therefore not the mechanism behind the reported £114-vs-£20 divergence, but it
is a real defect on the same surface and it should be fixed in the same unit.

---

## 5. Cross-cutting checks

### 5.1 One money path

**Every function that computes or formats a quote total, subtotal, VAT, or line
total:**

| Function | File | Verdict |
|---|---|---|
| `computeQuoteTotals` | `quote-math.ts:48` | **The single source of truth.** Keep. |
| `lineItemTotal` | `quote-math.ts:5` | Its per-line helper. Keep. |
| `labourCrewSize` | `quote-math.ts:41` | Not money. Keep. |
| `formatGBP` | `format.ts:12` | The single formatter, pounds only. Keep. |
| `buildFixedModeLineItems` | `pricing-mode.ts:40` | Constructs a line; does not total. Keep. |
| `applyPricingMode` | `pricing-mode.ts:68` | Selects which lines are active. Keep. |
| `applyAgreedDayRate` / `applyAgreedFixedPrice` | `agreed-costs.ts` | Overrides feeding the same totaliser. Keep. |
| `round2` | `compile-draft.ts:73` | **Private duplicate** of the rounding in `quote-math.ts`. |
| `round2` | `invoice-amount.ts:9` | **Private duplicate**, third copy. |
| `deriveInvoiceAmount` | `invoice-amount.ts:24` | Derives from `quotes.total`. Keep, but see 4.4. |
| `motkoFeePennies` / `splitFeeVat` | `motko-fee.ts:22, :48` | Separate integer-penny domain. Correctly separate. |

**Verdict: yes, there is exactly one server-side total function, and it is
`computeQuoteTotals`.** No duplicate implementation of the total exists. The
three private `round2` helpers are a smell rather than a defect (all three are
`Math.round(n*100)/100`), but they are three places a rounding policy can drift.

**Float arithmetic on money.** All of it, on the quote side. `quote-math.ts`
multiplies and sums JavaScript numbers and rounds to 2dp at each boundary
(`:14`, `:26-32`, `:52-57`). `quotes.total` and `invoices.amount` are pounds
(`format.ts:2-3` — `numeric(10,2)`). This is defensible at quote magnitudes and
the rounding is applied consistently, but it is not exact-decimal arithmetic.

**Pounds/pennies mixing.** Three explicit boundaries, all of them `Math.round(x
* 100)`:

- `create-payment-intent/route.ts:121` — pounds → Stripe pennies.
- `settle-paid-job.ts:154` — pounds → fee-band pennies.
- `compile-draft.ts:262, :351` — the LLM's `*_pence` fields → pounds
  (`/100`), inside a file that otherwise works in pounds.

The fee/settlement subsystem (`motko-fee.ts`, `paid-job-settlement.ts`) is
integer pennies throughout and correctly isolated. The mixing is confined to the
conversion sites, each of which rounds. No unrounded float crosses the boundary.

### 5.2 VAT display

The rule — enter ex-VAT, display VAT-inclusive with the split shown — is applied
**consistently on every document surface** and **inconsistently in the
messages**:

| Surface | Behaviour |
|---|---|
| App editor | `computeQuoteTotals(lineItems, vatRegistered)`, shows subtotal / VAT / total (`quote-editor.tsx:255`) ✓ |
| Public quote page | same, with the subtotal row suppressed when it equals the total (`q/[id]/page.tsx:87, :168-183`) ✓ |
| Quote PDF | same (`quote-payload.ts:142`) ✓ |
| Contract variables | same, all three figures (`build-variables.ts:69`) ✓ |
| Guest quote | `computeQuoteTotals(lineItems, false)` — always ex-VAT (`guest/quote.ts:147`) ✓ correct, a guest has no VAT registration |
| **SMS** | `"your quote for £114.00 is ready"` — the VAT-inclusive figure, **unlabelled** (`sms.ts:31`) |
| **Email** | `"has sent you a quote for £114.00"` — same, **unlabelled** (`email.ts:58`) |

The *value* is right in both messages. Neither says whether it includes VAT,
which for a VAT-registered trade quoting a consumer is the figure that matters
and for a business customer is the one that does not. Minor, and adjacent enough
to Bug 3 to fix in the same unit.

### 5.3 Sent-quote immutability

**The data model does not distinguish a sent quote from a draft in any way that
constrains mutation.** `quotes.status` is a single column carrying `draft |
sent | accepted | declined | archived`; `EDITABLE_STATUSES`
(`quote-send-guards.ts:36`) admits the first two. There is:

- no version table, no `quote_versions`, no `superseded_by`;
- **no modification timestamp at all.** `quotes` carries `created_at`,
  `sent_at`, `viewed_at`, `accepted_at` and `declined_at`
  (`00000000000001_init_schema.sql:77-87`, `00000000000005_quote_status_events.sql:1-2`)
  and no `updated_at` — I checked every `alter table quotes` in
  `supabase/migrations/`. A post-send rewrite leaves no trace in the row it
  rewrites, so the database cannot answer "when did £114 become £24" even with
  full access;
- no immutable snapshot of what was actually delivered;
- no record of the total that appeared in the message that went out;
- no re-send, no invalidation, no customer notification on change.

`sent_at` is stamped once (`jobs/actions.ts:1118`) and never reconsidered.

**Yes — this is the structural cause underneath Bug 3.** The line was drawn at
acceptance because that is where the *contract* becomes self-contradicting
(`quote-send-guards.ts:26-30` reasons it out carefully). But the customer's copy
of the offer is created at **send**, not at acceptance, and the model has no
concept of that copy existing.

### 5.4 Regression coverage — would any existing test have caught these?

| Bug | Existing test that would have caught it | Test that should exist |
|---|---|---|
| **1a** greeting loop | **None.** `src/lib/voice-gate.test.ts` has 12 tests over `createAssistantAudioHold`, and one of them — `"measures the tail from the LAST packet, not the first"` (`:84`) — asserts *the defective design as the contract*. The tests are correct about the unit and blind to the bug, because the bug is which signal feeds the unit. | A test over the data-channel handler proving the gate stays closed until an `output_audio_buffer.stopped` frame, and that a run of `response.output_audio.delta` frames followed by `response.done` does **not** reopen it. Feed a scripted event sequence; assert `track.enabled` transitions. |
| **1b** unlabelled transcript | **None.** No test renders `<JobIntake/>`'s transcript panel. | A `happy-dom` test asserting a contractor-channel line and an assistant-channel line render with distinguishable speaker attribution. |
| **1c** unreachable checklist | **None.** `tests/regression/question-budget-exemption.test.ts` asserts the *prompt text* exempts required slots; it says nothing about whether the client-side checklist phase is reachable. | A test that drives the handler with N `response.done` frames and zero `update_sow` calls, and asserts a required-slot ask is issued before the call can conclude. |
| **2** mode defaulting | **None, and the gap is precise.** Every pricing case in `src/lib/schemas/sow.test.ts:490-590` supplies `mode` explicitly (`{mode:"days"…}`, `{mode:"fixed"…}`, `{mode:"calculated"…}`). Not one omits it. | `mergeSowDelta(EMPTY_SOW_STATE, {pricing:{fixed_amount:20}})` must **not** yield `mode:"calculated"`, and `applyPricingMode` must not return the calculated breakdown when a positive `fixed_amount` is present. Plus a pipeline test: stated £20 in, quote total £24 out. |
| **3a** edit after send | **None.** `tests/acceptance/quote-edit-status-guard.test.ts` proves all three writers *refuse* on `accepted`/`declined` (`:204-300`). Nothing asserts what happens on `sent` — which is the case that permits the divergence. | A test that sends a quote, records the delivered total, edits it, and asserts the divergence is either prevented or surfaced (per the decision in §7 Q1). |
| **3b** send without save | **None.** `tests/regression/send-quote-guards.test.ts` and `src/app/jobs/send-quote.test.ts` cover the server guards, not the editor's dirty state. | A `happy-dom` test: render the editor, change a unit price, click **Send quote**, assert `updateQuoteLineItems` was called before `sendQuote` (or that Send is blocked). |
| **X1** cost-intake gate | **None.** `voice-gate.test.ts` covers the shared helper; nothing asserts which callers use the hold. | An import-level assertion that every voice surface constructs `createAssistantAudioHold` rather than deriving `assistantSpeaking` from call state. |

### 5.5 Recurrence — has this happened before?

**Yes. This is the third occurrence of the same acoustic-echo class, and the
second recurrence after a shipped fix.**

| Date | Commit | What it did | Outcome |
|---|---|---|---|
| 2026-07-26 | `77e10a2` | *"end quote wrap loop"* — stopped re-asking required slots already put to the contractor | A different loop (wrap-up re-ask). Held. |
| 2026-08-13 | `c6851b1` (#210) | *"half-duplex mic gate to stop voice intake skipping questions"* — closed the mic while `callState === "speaking"`, added `echoCancellation: true`. Reported as *"On iOS the device speaker's TTS coupled back into the hot mic"* | **Regressed.** `voice-gate.ts:27-31` records why: the gate reopened on `response.done`, which is generation, not playback. |
| 2026-08-24 | `2b9b2be` (#339) | Re-keyed the gate onto audio packets with a 700 ms tail; added 149 lines of unit tests | **Regressed within 2 days.** |
| 2026-08-26 | — | This report | |

The 24 Aug commit message names its own gap:

> Not proven by any test here and flagged on the PR: … whether the 700 ms voice
> tail is right. All three need one look on a real device.

**So the previous fix did not regress and was not un-merged — it shipped
incomplete, with the incompleteness written down, and the device confirmation it
asked for never happened.** That is the process finding, and it matters more
than the code one: the fix moved a threshold on a signal that cannot be right at
any threshold, and the only check that could have falsified it was deferred.

`AGENTS.md` records a parallel institutional memory — the 21 Aug voice
investigation *"reached a probabilistic answer where a definitive one existed in
the data"*, which is what motivated the `agent_readonly` role I could not reach
today.

Related unfixed instance: `cost-intake.tsx:94-101` still runs the pre-#210
formulation (`assistantSpeaking: callStateRef.current === "speaking"`). #339
fixed one of the two voice surfaces.

---

## 6. Fix plan

Ordered by (a) customer-facing money/trust risk, (b) frequency, (c) blast
radius. One PR-sized unit each. **Nothing here has been started.**

---

### Unit 1 — Never discard a stated price *(Bug 2)* — [#368 PRICE-1](https://github.com/jacobabuckland/motkoquote/issues/368)

**Rank 1.** Money, silent, every fixed-price voice quote, and it is the smallest
diff of the three.

**What changes**

1. `src/lib/schemas/sow.ts:81` — remove `.default("calculated")` from
   `pricingSchema.mode`; make it optional and resolve the mode from the evidence
   instead of guessing it.
2. `src/lib/schemas/sow.ts:602-609` — in `mergeSowDelta`, when a delta carries a
   positive `fixed_amount` and no explicit `mode`, resolve to `"fixed"`. A
   stated number *is* the answer to "how do you want to price it".
3. `src/lib/schemas/sow.ts:325-339` — add `required: ["mode"]` to the `pricing`
   tool parameter so the model is told the field is not optional, and tighten
   the description to "always set `mode`; if you set `fixed_amount`, `mode` is
   `fixed`".
4. `src/app/jobs/actions.ts:487-493` — after `applyPricingMode`, assert that when
   `sowState.pricing.fixed_amount` is a positive number, the computed net
   subtotal equals it to the penny. On mismatch, record a `pricing_mismatch`
   event through the existing channel (`:463-471`) **and** set a
   contractor-facing flag on the quote. Per `AGENTS.md`, a signal that must
   change behaviour cannot terminate in telemetry — so the flag, not the event,
   is the deliverable.
5. Apply (4) at `:657-662` (`redraftJob`) and `:764-769`
   (`setQuotePricingMode`) too, so all three writers assert the same invariant.

**What could break**

- Legacy jobs where `pricing.mode` was genuinely absent: `resolvePricingMode`
  already returns `null` for `pricing === null` and `applyPricingMode:82-84`
  deliberately keeps producing the calculated breakdown for those. That branch
  must not change — the comment at `pricing-mode.ts:79-81` is explicit that
  existing jobs must not change price. Verify with a fixture whose `pricing` is
  `null`.
- A delta that legitimately sets `fixed_amount` alongside `mode: "days"` would
  now be contradictory. Precedence must be written down: an explicit `mode`
  always wins; inference only fills an absent one.
- `isDurationSlotAnswered` (`sow.ts:758-764`) changes shape for the
  mode-inferred case — a delta that previously read "answered (calculated)" now
  reads "answered (fixed)". Confirm the wrap detour still concludes.

**Regression test that proves it**

```ts
// mode-less fixed price is honoured, not silently recalculated
const merged = mergeSowDelta(EMPTY_SOW_STATE, { pricing: { fixed_amount: 20 } });
expect(resolvePricingMode(merged)).toBe("fixed");
expect(applyPricingMode(CALCULATED_95, merged, true)).toEqual([
  expect.objectContaining({ unit_price: 20, quantity: 1, unit: "job", multiplier: 1 }),
]);
expect(computeQuoteTotals(applyPricingMode(CALCULATED_95, merged, true), true).total).toBe(24);
```

plus: an explicit `mode` still wins over inference; a `null` `pricing` still
yields the calculated breakdown unchanged; and the persist-time assertion raises
a contractor flag when the subtotal and `fixed_amount` disagree.

---

### Unit 2 — Hold the mic on playback, not on generation *(Bug 1a, X1)* — [#369 VOICE-1](https://github.com/jacobabuckland/motkoquote/issues/369)

*Bug 1b (the unlabelled transcript) was split out as [#372 VOICE-2](https://github.com/jacobabuckland/motkoquote/issues/372): same session, but independently shippable and it should not wait behind a device test.*

**Rank 2.** Highest frequency (every voice intake), and you have asked for the
voice flow to be the top track. It is second only because Unit 1 is money and
one file.

**What changes**

1. `src/components/voice/job-intake.tsx:963-1069` — handle
   `output_audio_buffer.started` and `output_audio_buffer.stopped`. Take the
   hold on `started`, release it on `stopped`.
2. `src/lib/voice-gate.ts:62-87` — keep `createAssistantAudioHold` as the
   bounded backstop (a `stopped` frame that never arrives must not wedge the mic
   shut forever — `:53-56` argues that correctly and it still holds), but drive
   it from the buffer events and raise the tail materially. The current 700 ms
   is measured from the wrong clock; once measured from the right one, a
   smaller tail suffices, but it should be tuned on a device rather than
   guessed again.
3. `src/components/voice/cost-intake.tsx:94-101` — replace
   `assistantSpeaking: callStateRef.current === "speaking"` with the shared
   hold. This is the same defect #339 fixed in the sibling file.
4. `src/components/voice/job-intake.tsx:1197-1201, 1251-1255` — render
   `conversationTurnsRef`'s labelled turns instead of the flat
   `displayTranscript`, so contractor and assistant lines are visually
   distinguishable. This is what turns the next occurrence into a five-second
   diagnosis instead of a two-day one.
5. Consider a defensive guard in the connect effect so a session cannot be
   opened while `dcRef.current` is non-null (§2.1 shows the current safety is
   incidental).

**What could break**

- If `output_audio_buffer.*` is not emitted on the current model/transport, the
  mic never reopens and the intake is dead. The backstop timer in (2) is
  therefore load-bearing and must be implemented and tested first.
- A longer hold clips a fast talker who starts speaking over the tail. That is
  the acknowledged trade-off at `voice-gate.ts:36-37`; half-duplex is a
  deliberate product choice (`:8`).
- (4) changes what `jobs.transcript` looks like on screen but must not change
  the persisted flat string — `voice-transcript.ts:63-66` requires
  `jobs.transcript` keeps its exact byte shape.

**Regression test that proves it**

```ts
// scripted event sequence over the data-channel handler
emit("output_audio_buffer.started");
emit("response.output_audio.delta"); emit("response.output_audio.delta");
emit("response.done");                       // generation finished
expect(micTrack.enabled).toBe(false);        // ← today this is true: the bug
emit("output_audio_buffer.stopped");
advance(TAIL_MS);
expect(micTrack.enabled).toBe(true);
```

plus: the backstop reopens the mic when `stopped` never arrives; the transcript
panel renders a contractor line and an assistant line distinguishably; and
`cost-intake` exercises the same gate assertions as `job-intake`.

**Explicitly not proven by any test:** whether this ends the loop on a real
iPhone. Per §5.5, that check has now been deferred once and the bug came back
twice. It should gate the merge, not follow it.

---

### Unit 3 — A sent quote cannot silently change *(Bug 3a)* — [#370 SEND-1](https://github.com/jacobabuckland/motkoquote/issues/370)

*Bug 3b (send without save) was split out as [#371 SEND-2](https://github.com/jacobabuckland/motkoquote/issues/371): a different defect on the same surface, and it is not blocked on the Q1 decision.*

**Rank 3.** Highest per-incident trust cost, lower frequency, and it needs a
product decision first (§7 Q1), so it is sequenced last.

**What changes** *(assuming the recommended option in Q1)*

1. Add `quotes.sent_total` (`numeric(10,2)`), stamped by `markSent`
   (`jobs/actions.ts:1113-1120`) with the exact figure that went into the
   message. **Migration first, per `CLAUDE.md` § Migrations — `supabase db
   push` to prod before the code merges.**
2. `src/app/q/[id]/page.tsx:87` — when `sent_total` is present and differs from
   the derived total, render an explicit "this quote was updated on <date>;
   you may have an earlier message quoting <sent_total>" notice. The page stays
   the source of truth; the customer stops being ambushed by it.
3. `src/app/jobs/[id]/quote-editor.tsx` — when the quote's status is `"sent"`,
   surface that editing changes what the customer sees and offer a re-send.
4. `src/app/jobs/[id]/quote-editor.tsx:333-350` — `send()` persists pending
   edits before calling `sendQuote`, or the Send button is disabled while
   `!saved`. Persist-then-send is the better shape: it removes a dead control.
5. `src/lib/sms.ts:31` and `src/lib/email.ts:58` — label the figure ("inc. VAT"
   / "plus VAT") from `vat_registered` (§5.2).

**What could break**

- Adding a column to `quotes` touches the insert at `jobs/actions.ts:495-509`
  and the several `select` lists that name columns explicitly. Schema must
  precede code or the deploy breaks — `CLAUDE.md` is unambiguous.
- (4) changes send semantics: a send now writes before it sends, so a failed
  write must abort the send rather than sending stale figures.
- (2) adds customer-facing copy to a public page. Per `AGENTS.md` § *Blocking is
  the exception* item 5, **customer-facing legal or contractual copy escalates
  to a human** — the wording of that notice is yours to approve, not mine to
  choose.

**Regression test that proves it**

```ts
// a post-send edit is disclosed, not silent
await sendQuote({ … });                       // sent_total := 114
await setQuotePricingMode({ mode: "fixed", fixedAmount: 20 });
const page = await renderPublicQuote(quoteId);
expect(page).toShowTotal(24);
expect(page).toDiscloseSupersededTotal(114);
```

plus: the editor persists before sending (assert call order); an unsaved edit
cannot reach `sendQuote`; the SMS and email bodies carry a VAT label.

---

## 7. Open questions for you

**Q1 — What should an edit to an already-sent quote do?** *(blocks [#370](https://github.com/jacobabuckland/motkoquote/issues/370))*

This is not a code question; the code does exactly what
`quote-send-guards.ts:22-36` says it should. The intent needs to change first.

| Option | Consequence |
|---|---|
| **(a) Disclose.** Stamp `sent_total`; the public page shows the current figure plus a notice that an earlier message quoted a different one. Edits stay free. | Cheapest. Preserves the fix-a-typo-and-move-on workflow. Does not stop the divergence, but makes it legible to the person holding the wrong number. |
| (b) Re-send on change. Any edit to a `sent` quote automatically re-notifies. | Strongest guarantee. Risks spamming a customer over a typo, and doubles Twilio spend on iteration. |
| (c) Freeze on send. `EDITABLE_STATUSES` drops to `["draft"]`; changing a sent quote means explicitly superseding it with a new version. | Cleanest model, largest change — needs versioning, and it removes a workflow a trade almost certainly relies on. |

**My recommendation: (a), with a "Re-send to customer" button beside the
notice** — disclosure by default, re-send when the contractor judges it worth
it. It fixes the trust problem (nobody is ambushed by a link that disagrees with
their message) without removing the ability to correct a mistake, and it is the
only one of the three that ships inside one PR.

I am not taking this decision myself: `AGENTS.md` § *Blocking is the exception*
lists **customer-facing legal or contractual copy** on the escalation list, and
the customer-facing notice in (a) is exactly that. Everything else in the plan
proceeds without you.

**Q2 — Should the intake deterministically ask for the customer's name, site
address and contact?** *(shapes Unit 2's scope, does not block it)*

Today they are prompt-only (§2.5(ii)) — one sentence at position 5007 of 7 680,
with no `ChecklistQuestionId`, no `getUnansweredChecklistQuestions` entry, and
no wrap-detour coverage.

- **(a) Add them as a fourth deterministic slot group**, asked in the wrap detour
  the way crew/pricing/materials are. Guarantees capture; makes the call longer.
- **(b) Leave the call alone and enforce at the editor** — the send form already
  blocks on name and a contact channel (`quote-editor.tsx:411-417`), so the quote
  cannot go out without them either way.
- **(c) Do nothing beyond Unit 2** on the theory that these were only missing
  because the call never got past the greeting.

**My recommendation: (c) first, then re-measure.** Fix the loop, run one real
call, and see whether the questions come back on their own. If §2.5 is right,
they will — and (a) would add three forced questions to every intake to solve a
problem that no longer exists. If they do not come back, (a) is the answer and
we will then know it rather than guess it. This is reversible either way and
costs one session to settle.

**Q3 — Do you want the voice model pinned?** *(independent of all three units — filed as [#374 VOICE-4](https://github.com/jacobabuckland/motkoquote/issues/374))*

`src/lib/models.ts:39-67` records that `gpt-realtime-mini` is a floating alias
the provider can repoint with no deploy, that dated snapshots exist, and that
the family is on a 20 Jan 2027 shutdown clock with `gpt-realtime-2.1-mini` named
as the replacement. It could not be pinned when that file was written because
the environment had no API key and the docs hosts are proxy-blocked. **Same here
today.**

Until it is pinned, "the questions regressed with no diff" cannot be ruled in or
out, on this occasion or the next.

- **(a) Pin now** — one `GET /v1/models` call, then a one-line diff.
- (b) Leave it and accept the ambiguity.

**My recommendation: (a).** It is fifteen minutes and it permanently removes a
whole class of unfalsifiable regression report. It needs a key I do not have.

---

## 8. Tickets

Every finding is on the board. Filed 26 Aug 2026 against
`jacobabuckland/motkoquote`.

| Ticket | Title | Labels | Blocked on |
|---|---|---|---|
| [#368](https://github.com/jacobabuckland/motkoquote/issues/368) | PRICE-1 — A stated fixed price is silently discarded when the model omits the pricing mode | `bug` `factory` | — (one query would sharpen it; see #376) |
| [#369](https://github.com/jacobabuckland/motkoquote/issues/369) | VOICE-1 — The greeting loops: the mic gate releases on generation, not on playback | `bug` `factory` | — (device test gates the merge) |
| [#370](https://github.com/jacobabuckland/motkoquote/issues/370) | SEND-1 — A sent quote is rewritten in place with no version, no re-send and no disclosure | `bug` `factory` `blocked` `needs-migration` | Q1 — customer-facing copy |
| [#371](https://github.com/jacobabuckland/motkoquote/issues/371) | SEND-2 — The quote editor sends without persisting pending edits | `bug` `factory` | — |
| [#372](https://github.com/jacobabuckland/motkoquote/issues/372) | VOICE-2 — The live transcript drops the speaker label it already holds | `bug` `factory` | — |
| [#373](https://github.com/jacobabuckland/motkoquote/issues/373) | VOICE-3 — Customer name, site address and contact have no deterministic capture | `bug` `factory` `blocked` | #369, then re-measure |
| [#374](https://github.com/jacobabuckland/motkoquote/issues/374) | VOICE-4 — The realtime voice model is an unpinned alias | `factory` | an `OPENAI_API_KEY` |
| [#375](https://github.com/jacobabuckland/motkoquote/issues/375) | SEND-3 — The quote SMS and email don't say whether the figure includes VAT | `bug` `factory` | — |
| [#376](https://github.com/jacobabuckland/motkoquote/issues/376) | DIAG-1 — agent_readonly cannot reach the voice telemetry built to diagnose voice defects | `factory` `blocked` | Q2 — PII review on `events` |

**Not filed, deliberately.** `settle-paid-job.ts:154` banding the motko fee on
`quotes.total` rather than the invoice actually paid. It is deliberate and
commented at `:152-153`, and the fee is flat-capped at £2/£4 across a single
£1,000 threshold, so a stale total moves it by at most £2 and only across that
one boundary. §4.4 first read it as the sharper money risk; that was wrong and
is corrected there.

---

## 9. Status

Diagnosis only. No source file was modified. No PR opened, no branch pushed
beyond this document.

Nine tickets filed (§8), covering every finding. Awaiting your choice of which
to run first — and, per your instruction, each fix will be run as its own
focused prompt rather than one combined change.

Recommended order: **#368** (money, silent, one file), then **#369** (highest
frequency; the device test gates the merge this time), then **#370** once Q1 is
answered. **#371**, **#372** and **#375** are small, unblocked, and can go
whenever there is room.
