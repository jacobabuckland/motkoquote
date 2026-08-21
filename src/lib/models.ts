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

// NOT PINNED — and not pinnable from the deploy environment. See the block
// below before changing either of these.
//
// Checked 2026-08-21. Both are bare aliases the provider can repoint without a
// deploy on our side. Dated snapshots demonstrably exist for the realtime model
// (gpt-realtime-mini-2025-10-06 and gpt-realtime-mini-2025-12-15 are both
// documented), so pinning is possible in principle — but which snapshot the
// alias resolves to TODAY could not be verified when this file was written:
// platform.openai.com and developers.openai.com are both blocked by the network
// egress proxy, and no OPENAI_API_KEY was available to query GET /v1/models.
//
// Writing a snapshot we cannot verify is worse than leaving the alias: pinning
// to a retired snapshot fails session creation outright, which takes the whole
// voice intake down rather than degrading it. So these stay aliases until
// someone with API access resolves them:
//
//     curl https://api.openai.com/v1/models \
//       -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[].id'
//
// Then replace each value with the dated snapshot and record the date here.
//
// ALSO OUTSTANDING — this family is on a deprecation clock. OpenAI's 20 Jul
// 2026 notice covers the legacy audio/realtime/transcription models; the
// documented shutdown is 20 Jan 2027, with gpt-realtime-2.1-mini named as the
// replacement for gpt-realtime-mini. Migrating is a behaviour change on the
// call most sensitive to instruction-following, so it is its own decision and
// its own ticket — but it has a deadline, and the alias will move under us
// before then.
export const VOICE_MODEL = "gpt-realtime-mini";
export const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

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
