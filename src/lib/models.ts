// Every model identifier and sampling parameter the app sends, in one place.
//
// Why this file exists: a floating model alias can be repointed by the provider
// with no deploy on our side, so behaviour changes with no diff to inspect. The
// 21 Aug 2026 voice-intake investigation spent its first hours ruling that out
// by hand across three call sites. Centralising them makes the next such
// question a single file read, and makes a repin a reviewable one-line diff.
//
// Rules for this file:
//   * Every identifier carries a dated comment saying when it was last checked
//     and whether it is pinned.
//   * When a provider deprecates a pinned snapshot, REPIN and re-test. Never
//     revert to a bare alias to make a deprecation warning go away — that
//     re-creates exactly the un-diffable failure mode this file exists to stop.
//   * Sampling parameters are set explicitly wherever the provider accepts
//     them, so the value is a knob rather than an inherited default.

// ---------------------------------------------------------------------------
// Anthropic — the drafting / narrative calls (src/lib/claude.ts)
// ---------------------------------------------------------------------------

// Checked 2026-08-21. This IS the complete, canonical model ID — current
// Anthropic model IDs are not alias/dated-snapshot pairs, and appending a date
// suffix (claude-sonnet-4-6-20251114 or similar) is rejected. So there is no
// "more pinned" form of this string to move to: it is already exact.
export const DRAFTING_MODEL = "claude-sonnet-4-6";

// Anthropic's default when temperature is omitted is 1.0. Set explicitly so the
// value is visible and tunable; this commit is deliberately behaviour-neutral.
// Slot-filling and structure-proposing both want determinism, so this is the
// first number to try lowering if drafting output proves unstable — but that is
// a behaviour change and belongs in its own commit.
export const DRAFTING_TEMPERATURE = 1.0;

// ---------------------------------------------------------------------------
// OpenAI — the live voice session (src/lib/realtime.ts)
// ---------------------------------------------------------------------------

// PINNED. Checked 2026-08-26 against GET /v1/models on the motkoquote project.
//
// `gpt-realtime-mini` is an alias the provider can repoint with no deploy on our
// side, so what we send is the snapshot instead. On the date checked,
// gpt-realtime-mini-2025-12-15 was the ONLY gpt-realtime-mini-* snapshot the
// project could reach, so the alias almost certainly resolved to it and pinning
// is behaviour-neutral today. That is the point: this freezes what we are
// already being served rather than changing it.
//
// Worth recording, because it is the closest thing to evidence that the alias
// really does move under us. On 2026-08-21 this file stated that
// gpt-realtime-mini-2025-10-06 and gpt-realtime-mini-2025-12-15 were both
// documented. Five days later the October snapshot was not in the project's
// model list at all. That is not proof of a repoint — /v1/models reports what a
// project can reach, never what an alias points at — but the landscape under the
// alias demonstrably changed inside the same window in which the voice intake
// was reported to have got materially worse with no diff to inspect. See #374.
export const VOICE_MODEL = "gpt-realtime-mini-2025-12-15";

// NOT PINNED — deliberately. This is the one identifier still on a bare alias,
// and leaving it there was the decision rather than the omission.
//
// Checked 2026-08-26. Two snapshots were reachable, gpt-4o-mini-transcribe-
// 2025-12-15 and gpt-4o-mini-transcribe-2025-03-20, and which of them the alias
// resolves to cannot be determined from that list: it reports what exists, never
// what an alias points at. Newest-wins is the usual convention, but it is an
// assumption, and guessing wrong silently changes transcription behaviour on the
// one call where a mis-transcription has already cost a diagnosis — the echoed
// "Jacob" that came back as "Jake" and read as a hallucinating model (see #372).
//
// Pinning the realtime model above closes the risk that actually matters, which
// is instruction-following. Half the exposure closed with none of the guesswork
// beat pinning both on a convention. To finish this: establish the mapping with
// the provider, or pin one snapshot and A/B it deliberately — then pin, and move
// this block up to join the one above.
export const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

// DEPRECATION CLOCK — applies to both identifiers above. OpenAI's 20 Jul 2026
// notice covers the legacy audio/realtime/transcription models; the documented
// shutdown is 20 Jan 2027, with gpt-realtime-2.1-mini named as the replacement
// for gpt-realtime-mini. It was confirmed reachable on 2026-08-26. Migrating is
// a behaviour change on the call most sensitive to instruction-following, so it
// is its own decision and its own ticket — but it has a deadline, and a pinned
// snapshot will fail loudly when it arrives rather than degrading in silence.
// Repin and re-test when it does; never fall back to a bare alias to clear a
// deprecation warning (see the rules at the top of this file).

// Transcription language hint. Pinned to English (UK contractors, English-only
// app) rather than letting the model auto-detect per turn — auto-detect
// mis-fires on names, trade jargon and short utterances.
export const TRANSCRIPTION_LANGUAGE = "en";

// Deliberately no VOICE_TEMPERATURE constant.
//
// V2 asked for temperature to be set explicitly on the realtime session as
// well. It is not set here because whether the current GA realtime session
// object still accepts a `temperature` field could not be verified from this
// environment (same egress block as above), and an unrecognised field on the
// client-secret mint is rejected — which fails session creation and takes voice
// down entirely. That is a strictly worse outcome than inheriting a default.
//
// To finish this: confirm the field against the realtime session schema, then
// add it here and pass it through createRealtimeClientSecret alongside the
// model. Do not add it speculatively.
