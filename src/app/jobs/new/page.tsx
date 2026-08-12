"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRealtimeSession,
  saveSowDelta,
  completeSowConversation,
  createManualJob,
  saveVoiceTranscript,
  reportVoicePipelineFailure,
  saveContractorFirstName,
  recordTeamMember,
} from "../actions";
import {
  EMPTY_SOW_STATE,
  CHECKLIST_QUESTIONS,
  REQUIRED_CHECKLIST_QUESTIONS,
  getUnansweredChecklistQuestions,
  getUnansweredRequiredChecklistQuestions,
  resolveWrapReason,
  userSignaledCompletion,
  MAX_ASSISTANT_QUESTIONS,
  MAX_SESSION_MS,
  type SowState,
  type ChecklistQuestionId,
  type WrapReason,
} from "@/lib/schemas/sow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { classifyMicError, type MicFailureKind } from "@/lib/mic";
import { MicExplainer, MicFailureScreen } from "@/components/voice/mic-permission-screen";

type CallState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "finishing"
  | "error";

// "description" is the initial free-form "talk me through the job" phase;
// "followup" is the one-question-at-a-time checklist phase that runs after
// it (see maybeStartFollowups) for whichever of the 5 practical questions
// the contractor didn't already cover unprompted.
type Phase = "description" | "followup";

const MAX_TOOL_TURNS = 5;

// A follow-up question gets re-asked once if the contractor's answer
// didn't land in the expected field, then the app moves on rather than
// getting stuck repeating itself.
const MAX_QUESTION_ATTEMPTS = 2;

// A wrap-up detour (the compact combined ask of any still-unanswered required
// slots when the contractor ends the call, or a cap trips) is hard-bounded to
// this many assistant turns: the combined question, then the contractor's
// answer. Past that we draft from whatever's landed rather than re-asking —
// un-landed required slots flow to the assumptions layer, never a loop.
const WRAP_DETOUR_MAX_TURNS = 2;

// Wall-clock backstop for a wrap-up detour. The turn bound above only advances
// on assistant `response.done` events; if the contractor goes silent or the
// Realtime channel stops emitting them (seen on iOS Safari when the mic/
// AudioContext stalls), the detour would otherwise hang forever — the drafting
// pipeline never starts, so its own PIPELINE_TIMEOUT_MS never applies. After
// this long with no detour activity, draft from whatever's landed.
const WRAP_DETOUR_TIMEOUT_MS = 15_000;

// How long the mic has to sit below the speech threshold, after speech has
// happened, before we treat the contractor as "done talking for now" and
// react — as opposed to a normal mid-thought pause. OpenAI's own
// semantic_vad ends the turn server-side too, but that round trip can lag;
// this local heuristic is what removes the dead-air feeling. Range asked
// for is ~2.5–3s — tune against a real device/mic if it feels early/late.
const SILENCE_MS = 2800;
const AUDIO_SAMPLE_MS = 80;
// RMS of normalised (-1..1) time-domain samples. Below this is treated as
// background/room noise, not speech. Tune against real hardware — quiet
// mics or noisy sites (radio, traffic) may need this raised or lowered.
const SPEECH_RMS_THRESHOLD = 0.025;

const THINKING_MESSAGES = ["Got it — one sec…", "Thinking it through…"];

// The two visible stages of the voice→quote pipeline. The server does the
// write-up and pricing in one call (completeSowConversation), so these tick
// on a cosmetic timer — stage 1 shows the moment the call wraps, stage 2
// takes over after a beat — rather than tracking real server sub-steps.
const FINISH_STAGES = [
  "Got it — writing up the job",
  "Pricing it from your rates",
] as const;
const STAGE_ADVANCE_MS = 7_000;

// If the whole pipeline hasn't returned in this long, treat it as stalled and
// drop to the failure screen (Retry / Save and finish later) rather than
// leaving the contractor watching a spinner forever.
const PIPELINE_TIMEOUT_MS = 90_000;

// Rejects if the wrapped promise hasn't settled within `ms` — the client-side
// stall guard for the drafting pipeline.
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("This is taking longer than it should.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

// Live speech-to-speech job intake. The browser opens a direct WebRTC
// connection to OpenAI's Realtime API using a short-lived token minted by
// createRealtimeSession — audio in, audio out, and tool calls all flow over
// that one connection with no server round trip per turn, which is what
// makes this feel like a live conversation instead of record → wait → play.
export default function NewJobPage() {
  const router = useRouter();
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [sowState, setSowState] = useState<SowState | null>(null);
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState<Phase>("description");
  const [activeQuestion, setActiveQuestion] = useState<ChecklistQuestionId | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [rotatingText, setRotatingText] = useState<string | null>(null);
  // attempt 0 = pre-permission explainer; each Start/Try again bumps it and
  // (re)runs the connect effect, so the microphone is only ever touched after
  // a deliberate tap. micFailure holds the classified getUserMedia failure so
  // we can show the right recovery screen instead of a generic error line.
  const [attempt, setAttempt] = useState(0);
  const [micFailure, setMicFailure] = useState<MicFailureKind | null>(null);
  const [manualPending, setManualPending] = useState(false);
  // Staged progress: which pipeline stage is currently active (0 = writing up,
  // 1 = pricing). pipelineFailed swaps the staged screen for the stall/failure
  // recovery screen; savingForLater guards the "Save and finish later" button.
  const [finishStage, setFinishStage] = useState(0);
  const [pipelineFailed, setPipelineFailed] = useState(false);
  const [savingForLater, setSavingForLater] = useState(false);
  // Transcript display state - mirrors transcriptRef to trigger re-renders
  const [displayTranscript, setDisplayTranscript] = useState<string[]>([]);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  const jobIdRef = useRef<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const toolTurnsRef = useRef(0);
  const transcriptRef = useRef<string[]>([]);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(false);
  // Task 3 wrap-up bookkeeping. sessionStartedAt is set the instant the data
  // channel opens, so the 6-minute hard cap measures live-call time, not
  // connect/permission time. questionsAsked counts completed assistant turns
  // as an upper-bound proxy for "questions asked" — a safety-net cap, so
  // over-counting only ends a runaway call slightly sooner. userDone latches
  // once the contractor says "that's it" so the wrap reason logs as 'user'.
  const sessionStartedAtRef = useRef(0);
  const questionsAskedRef = useRef(0);
  const userDoneRef = useRef(false);
  // Held so retry() can re-draft with the same reason after a network blip.
  const wrapReasonRef = useRef<WrapReason>("slots");
  // Mirrors finishStage synchronously so the pipeline catch block can tag the
  // failure with whichever stage was on screen when it broke. stageTimerRef
  // holds the cosmetic stage-advance timer so it can be cancelled on
  // success/failure.
  const finishStageRef = useRef(0);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors sowState/phase/activeQuestion synchronously for use inside
  // handleToolCall/askNextQuestion, which run from WebRTC data-channel
  // callbacks and would otherwise close over stale state.
  const sowStateRef = useRef<SowState | null>(null);
  const phaseRef = useRef<Phase>("description");
  const activeQuestionRef = useRef<ChecklistQuestionId | null>(null);
  const followupQueueRef = useRef<ChecklistQuestionId[]>([]);
  const questionAttemptsRef = useRef(0);
  // Task D: which required slots (crew/duration/materials_supply) were actually
  // put to the contractor this call, for the slot-coverage telemetry passed to
  // completeSowConversation. pendingWrapReasonRef holds the reason a wrap was
  // trying to conclude with while we detour to ask outstanding required slots
  // first, so the eventual conclusion logs the reason the wrap started with.
  const askedRequiredSlotsRef = useRef<ChecklistQuestionId[]>([]);
  const pendingWrapReasonRef = useRef<WrapReason | null>(null);
  // A wrap-up detour is in flight: the contractor (or a cap) tried to end the
  // call while required slots were still open, so we asked them all together in
  // one compact turn. wrapDetourTurnsRef bounds it to WRAP_DETOUR_MAX_TURNS.
  const wrapDetourActiveRef = useRef(false);
  const wrapDetourTurnsRef = useRef(0);
  // Wall-clock backstop for the detour (see WRAP_DETOUR_TIMEOUT_MS): armed when
  // the detour starts, re-armed on each detour turn, cleared on conclude.
  const wrapDetourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors callState synchronously so the audio-level sampling loop and
  // WebRTC event handlers (both fire outside React's render cycle) never
  // act on a stale closure.
  const callStateRef = useRef<CallState>("connecting");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smoothedLevelRef = useRef(0);
  const hasSpokenRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const workingCueFiredRef = useRef(false);

  const updateCallState = (next: CallState) => {
    callStateRef.current = next;
    setCallState(next);
  };

  const stopRotatingMessages = () => {
    if (rotatingTimerRef.current) {
      clearTimeout(rotatingTimerRef.current);
      rotatingTimerRef.current = null;
    }
    setRotatingText(null);
  };

  const startRotatingMessages = (messages: string[]) => {
    stopRotatingMessages();
    setRotatingText(messages[0] ?? null);
    if (messages.length <= 1) return;
    let i = 0;
    const tick = () => {
      i = (i + 1) % messages.length;
      setRotatingText(messages[i] ?? null);
      rotatingTimerRef.current = setTimeout(tick, 3500);
    };
    // First message shows immediately and holds for ~5s before rotating —
    // fast responses never show a rotation at all.
    rotatingTimerRef.current = setTimeout(tick, 5000);
  };

  // Haptic + audio confirmation that we heard them and are acting on it —
  // fires once per turn, the instant we stop listening (auto or manual),
  // so the screen never just sits there.
  const fireWorkingCue = () => {
    if (workingCueFiredRef.current) return;
    workingCueFiredRef.current = true;

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(35);
    }

    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;
      const cueCtx = new AudioCtor();
      const osc = cueCtx.createOscillator();
      const gain = cueCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, cueCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, cueCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, cueCtx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(cueCtx.destination);
      osc.start();
      osc.stop(cueCtx.currentTime + 0.2);
      osc.onended = () => void cueCtx.close();
    } catch {
      // The confirmation sound is a nicety — never let it break the flow.
    }
  };

  const stopLevelMonitoring = () => {
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  // Reads the live mic level every AUDIO_SAMPLE_MS. Drives the pulsing
  // level-meter indicator, and — while we're actually listening — detects
  // sustained silence after speech to auto-advance out of "listening"
  // without waiting for the manual stop button.
  const sampleAudioLevel = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = ((data[i] ?? 128) - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    smoothedLevelRef.current = smoothedLevelRef.current * 0.7 + rms * 0.3;
    setMicLevel(smoothedLevelRef.current);

    if (callStateRef.current !== "listening") return;

    const now = Date.now();
    if (rms > SPEECH_RMS_THRESHOLD) {
      hasSpokenRef.current = true;
      lastSpeechAtRef.current = now;
      return;
    }

    if (hasSpokenRef.current && now - lastSpeechAtRef.current >= SILENCE_MS) {
      fireWorkingCue();
      updateCallState("thinking");
      startRotatingMessages(THINKING_MESSAGES);
    }
  };

  const startLevelMonitoring = (stream: MediaStream) => {
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = new AudioCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      levelIntervalRef.current = setInterval(sampleAudioLevel, AUDIO_SAMPLE_MS);
    } catch {
      // Level metering is a UX nicety — the call still works without it.
    }
  };

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dcRef.current?.close();
    pcRef.current?.close();
    // Null the refs after closing so nothing can send on a torn-down channel or
    // read a stopped stream — the send/toggle guards treat null as "not live".
    streamRef.current = null;
    dcRef.current = null;
    pcRef.current = null;
    stopLevelMonitoring();
    if (stageTimerRef.current) {
      clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    if (wrapDetourTimerRef.current) {
      clearTimeout(wrapDetourTimerRef.current);
      wrapDetourTimerRef.current = null;
    }
  };

  const setStage = (n: number) => {
    finishStageRef.current = n;
    setFinishStage(n);
  };

  // Drives the staged progress screen and drafts the quote. The server does
  // the write-up and pricing in one call; the two on-screen stages tick on a
  // cosmetic timer. If the call throws or overruns PIPELINE_TIMEOUT_MS, we
  // drop to the stall/failure screen and log the stage that was showing.
  const draftQuote = async () => {
    const jobId = jobIdRef.current;
    if (!jobId) {
      stopRotatingMessages();
      setError("Lost track of the job — try recording again.");
      updateCallState("error");
      return;
    }

    setError(null);
    setPipelineFailed(false);
    stopRotatingMessages();
    setStage(0);
    setCallState("finishing");

    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    stageTimerRef.current = setTimeout(() => setStage(1), STAGE_ADVANCE_MS);

    try {
      await withTimeout(
        completeSowConversation({
          jobId,
          transcript: transcriptRef.current.join("\n"),
          wrapReason: wrapReasonRef.current,
          questionsAsked: questionsAskedRef.current,
          requiredSlotsAsked: askedRequiredSlotsRef.current,
        }),
        PIPELINE_TIMEOUT_MS,
      );
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      // The conversation is captured server-side and the transcript sits in a
      // ref — surface the stall/failure with Retry (re-draft, no re-record)
      // and Save and finish later (persist and step away).
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
      const stage = finishStageRef.current === 0 ? "writing" : "pricing";
      const message =
        err instanceof Error ? err.message : "Something went wrong drafting the quote.";
      void reportVoicePipelineFailure({ jobId, stage, message }).catch(() => {});
      setPipelineFailed(true);
      updateCallState("error");
    }
  };

  // Re-drafts without re-recording anything — the transcript and job id are
  // already sitting in refs, untouched by the failure, so a flaky network call
  // is a "try again", not a "start over".
  const retry = () => {
    setError(null);
    setPipelineFailed(false);
    if (jobIdRef.current && transcriptRef.current.length > 0) {
      void draftQuote();
    } else {
      window.location.reload();
    }
  };

  // Persists the transcript against the job and steps away — nothing spoken is
  // lost, the contractor can come back to it. Best-effort save: even if it
  // fails we still leave the stall screen rather than trapping them on it.
  const saveForLater = () => {
    const jobId = jobIdRef.current;
    setSavingForLater(true);
    void (async () => {
      if (jobId) {
        try {
          await saveVoiceTranscript({
            jobId,
            transcript: transcriptRef.current.join("\n"),
          });
        } catch {
          // Best effort — don't block the exit on a failed save.
        }
      }
      router.push("/");
    })();
  };

  // Trade-friendly instructions for a single response.create call, steering
  // the model to ask exactly one checklist question and wait for the
  // answer — without permanently changing the session's instructions, so
  // the rest of the live call (and any earlier context) is unaffected.
  const buildQuestionInstructions = (id: ChecklistQuestionId) =>
    `Ask the contractor this exact question, in your own natural voice, then wait for their answer: ` +
    `"${CHECKLIST_QUESTIONS[id]}" Once they answer — even if the answer is "no one else", "not sure yet", ` +
    `or "nothing's been agreed" — call update_sow with the relevant field set to reflect that; do not ` +
    `leave the field unset just because the answer was "no" or "nothing". Ask only this one question, ` +
    `nothing else — don't move on to any other topic.`;

  // The wrap-up detour asks every still-open required slot together, in ONE
  // short turn, rather than looping question-by-question — the contractor is
  // trying to end the call, so we get the must-haves in a single quick breath.
  const buildCombinedWrapInstruction = (ids: ChecklistQuestionId[]) => {
    const questions = ids.map((id) => CHECKLIST_QUESTIONS[id]).join(" ");
    return (
      `Before I price this up, quickly ask the contractor these remaining questions together, in one ` +
      `short natural turn — in your own voice, not read out verbatim: ${questions} ` +
      `Ask them all in a single breath as a brief wrap-up, then wait. Whatever they say, call update_sow ` +
      `to record it — even "not sure", "you work it out", or "no one else"; set the relevant fields rather ` +
      `than leaving them unset. If they deflect or don't know, that's fine — don't push, I'll take it from ` +
      `here. Ask only these, nothing new.`
    );
  };

  // Pops and asks the next unanswered checklist question over the same
  // live call, or finishes the conversation once the queue is empty.
  const askNextQuestion = () => {
    const dc = dcRef.current;
    const nextId = followupQueueRef.current.shift();
    if (!nextId || !dc) {
      // A wrap that detoured to ask outstanding required slots concludes with
      // the reason it started with; an ordinary drained follow-up queue
      // resolves the reason fresh from the live signals.
      const reason = pendingWrapReasonRef.current ?? wrapReasonNow();
      pendingWrapReasonRef.current = null;
      void finishConversation(reason);
      return;
    }
    questionAttemptsRef.current = 0;
    activeQuestionRef.current = nextId;
    setActiveQuestion(nextId);
    if (
      REQUIRED_CHECKLIST_QUESTIONS.includes(nextId) &&
      !askedRequiredSlotsRef.current.includes(nextId)
    ) {
      askedRequiredSlotsRef.current.push(nextId);
    }
    sendResponse(dc, buildQuestionInstructions(nextId));
  };

  // Called once the initial free-form description phase ends (model called
  // finish_job, or the contractor tapped "Done"). Only asks whatever the
  // checklist above wasn't already covered — if everything was already
  // covered, drafts the quote immediately, same as today.
  const maybeStartFollowups = () => {
    const current = sowStateRef.current ?? EMPTY_SOW_STATE;
    const unanswered = getUnansweredChecklistQuestions(current);
    if (unanswered.length === 0) {
      void finishConversation(wrapReasonNow());
      return;
    }
    followupQueueRef.current = unanswered;
    phaseRef.current = "followup";
    setPhase("followup");
    askNextQuestion();
  };

  // Every way of ending the call — the model's wrap_up/finish_job, the
  // contractor's "Finish & price it up", or a hard cap — funnels through here.
  // None may end while any of the three REQUIRED slots (crew, duration,
  // materials_supply) is still unanswered: they're must-ask, so they can never
  // surface as a post-call flag on a call that ended cleanly. If any remain, we
  // detour to ask them ALL in one compact turn (buildCombinedWrapInstruction),
  // hard-bounded to WRAP_DETOUR_MAX_TURNS — not a per-slot loop — then conclude
  // with the reason the wrap started with. The two nice-to-have slots
  // (deadline, agreed_costs) never hold up a wrap the contractor initiated.
  const concludeOrAskRequired = (reason: WrapReason) => {
    if (endedRef.current) return;
    // Already mid-detour (e.g. a cap tripped, or Done was tapped again, while
    // the compact ask is out). An automatic re-trigger (another cap, a repeat
    // finish_job) must not stack a second ask — let the active detour's turn
    // bound / timeout conclude it. But a manual press is the contractor forcing
    // the issue: draft now from whatever's landed rather than leaving them stuck
    // behind an ask that never resolved.
    if (wrapDetourActiveRef.current) {
      if (reason === "manual") concludeWrapDetour();
      return;
    }
    const current = sowStateRef.current ?? EMPTY_SOW_STATE;
    // Only detour for required slots we haven't already put to the contractor
    // this call. A slot asked once but never landed a concrete value (e.g.
    // "just work it out") must NOT hold up the wrap — asked-once is enough; an
    // un-landed answer flows to the assumptions layer, exactly as designed.
    const unansweredRequired = getUnansweredRequiredChecklistQuestions(current).filter(
      (id) => !askedRequiredSlotsRef.current.includes(id),
    );
    const dc = dcRef.current;
    if (unansweredRequired.length === 0 || !dc) {
      void finishConversation(reason);
      return;
    }
    // Mark every slot we're about to raise as asked up front, so it counts as
    // put-to-the-contractor even if the answer never lands, and a re-entrant
    // wrap can't re-queue it.
    for (const id of unansweredRequired) {
      if (!askedRequiredSlotsRef.current.includes(id)) askedRequiredSlotsRef.current.push(id);
    }
    pendingWrapReasonRef.current = reason;
    wrapDetourActiveRef.current = true;
    wrapDetourTurnsRef.current = 0;
    armWrapDetourTimeout();
    phaseRef.current = "followup";
    setPhase("followup");
    sendResponse(dc, buildCombinedWrapInstruction(unansweredRequired));
  };

  // (Re)arms the detour's wall-clock backstop. Called when the detour starts
  // and on each detour turn, so it only fires after genuine inactivity.
  const armWrapDetourTimeout = () => {
    if (wrapDetourTimerRef.current) clearTimeout(wrapDetourTimerRef.current);
    wrapDetourTimerRef.current = setTimeout(() => {
      if (wrapDetourActiveRef.current && !endedRef.current) concludeWrapDetour();
    }, WRAP_DETOUR_TIMEOUT_MS);
  };

  // Ends a wrap-up detour: whatever the contractor gave to the compact ask has
  // been saved; draft now (un-landed required slots were already marked asked
  // and flow to the assumptions layer). Idempotent — the update_sow answer and
  // the turn-bound backstop both call it, whichever fires first.
  const concludeWrapDetour = () => {
    if (!wrapDetourActiveRef.current) return;
    wrapDetourActiveRef.current = false;
    if (wrapDetourTimerRef.current) {
      clearTimeout(wrapDetourTimerRef.current);
      wrapDetourTimerRef.current = null;
    }
    const reason = pendingWrapReasonRef.current ?? wrapReasonNow();
    pendingWrapReasonRef.current = null;
    void finishConversation(reason);
  };

  const finishConversation = async (reason: WrapReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    wrapReasonRef.current = reason;
    workingCueFiredRef.current = true;
    fireWorkingCue();
    updateCallState("finishing");
    cleanup();
    await draftQuote();
  };

  // Resolves the wrap reason from the live signals at the moment the model
  // (or a cap) decides to end — see resolveWrapReason. Used for the model's
  // own wrap_up/finish_job conclusions; manual and cap endings pass their
  // reason directly.
  const wrapReasonNow = (): WrapReason =>
    resolveWrapReason({
      manual: false,
      userSignaledDone: userDoneRef.current,
      questionsAsked: questionsAskedRef.current,
      elapsedMs: sessionStartedAtRef.current ? Date.now() - sessionStartedAtRef.current : 0,
    });

  const handleToolCall = async (name: string, callId: string, argsJson: string) => {
    const jobId = jobIdRef.current;
    const dc = dcRef.current;
    if (!jobId || !dc) return;

    if (name === "update_sow") {
      toolTurnsRef.current += 1;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        // Malformed args — ack with nothing captured rather than dropping
        // the conversation.
      }

      let updated: SowState | null = null;
      try {
        const result = await saveSowDelta({ jobId, delta: parsedArgs });
        updated = result.sowState;
        setSowState(updated);
        sowStateRef.current = updated;
      } catch {
        // A single failed save shouldn't kill the live conversation — the
        // model will likely mention it again if it mattered.
      }

      sendToolAck(dc, callId, { ok: true });

      // The contractor just answered the compact wrap-up ask (whatever landed
      // is saved above) — draft now, no per-slot loop.
      if (wrapDetourActiveRef.current) {
        concludeWrapDetour();
        return;
      }

      if (phaseRef.current === "followup" && activeQuestionRef.current) {
        const stillUnanswered = updated
          ? getUnansweredChecklistQuestions(updated).includes(activeQuestionRef.current)
          : true;
        if (!stillUnanswered) {
          askNextQuestion();
        } else {
          questionAttemptsRef.current += 1;
          if (questionAttemptsRef.current >= MAX_QUESTION_ATTEMPTS) {
            // Didn't land after a retry — move on rather than get stuck.
            askNextQuestion();
          } else {
            sendResponse(dc, buildQuestionInstructions(activeQuestionRef.current));
          }
        }
        return;
      }

      sendResponse(dc);

      if (phaseRef.current === "description" && toolTurnsRef.current >= MAX_TOOL_TURNS) {
        maybeStartFollowups();
      }
      return;
    }

    if (name === "finish_job") {
      sendToolAck(dc, callId, { ok: true });
      if (phaseRef.current === "description") {
        maybeStartFollowups();
      } else {
        concludeOrAskRequired(wrapReasonNow());
      }
      return;
    }

    // The model asked the contractor their own name (only when it wasn't
    // already known) and is reporting it back — persist it against the account
    // so the next session can open by name, then carry on the conversation.
    if (name === "record_first_name") {
      let firstName = "";
      try {
        const parsed = argsJson ? (JSON.parse(argsJson) as { first_name?: unknown }) : {};
        if (typeof parsed.first_name === "string") firstName = parsed.first_name.trim();
      } catch {
        // Malformed args — ack and move on rather than dropping the call.
      }
      sendToolAck(dc, callId, { ok: true });
      if (firstName) void saveContractorFirstName({ firstName }).catch(() => {});
      sendResponse(dc);
      return;
    }

    // The contractor named someone helping on the job who isn't on their team,
    // and gave their role + day rate (Task D). Persist them as a team member
    // so this same quote — completeSowConversation re-reads team_members at
    // draft time — and every future job can price them at their real rate,
    // then carry the conversation on.
    if (name === "record_person") {
      let name_ = "";
      let role: string | undefined;
      let dayRate: number | null = null;
      try {
        const parsed = argsJson
          ? (JSON.parse(argsJson) as { name?: unknown; role?: unknown; day_rate?: unknown })
          : {};
        if (typeof parsed.name === "string") name_ = parsed.name.trim();
        if (typeof parsed.role === "string" && parsed.role.trim()) role = parsed.role.trim();
        if (typeof parsed.day_rate === "number" && Number.isFinite(parsed.day_rate)) {
          dayRate = parsed.day_rate;
        }
      } catch {
        // Malformed args — ack and move on rather than dropping the call.
      }
      sendToolAck(dc, callId, { ok: true });
      if (name_ && dayRate != null && dayRate >= 0) {
        void recordTeamMember({
          name: name_,
          ...(role ? { role } : {}),
          day_rate: dayRate,
        }).catch(() => {});
      }
      sendResponse(dc);
      return;
    }

    // The model's clean-conclusion tool (Task 3): it decided there's nothing
    // left worth asking, or the contractor said they're done. Ends the call —
    // but first (Task D) ensures the three required slots were asked, so a
    // clean wrap can never leave crew/duration/materials to surface as a flag.
    if (name === "wrap_up") {
      sendToolAck(dc, callId, { ok: true });
      concludeOrAskRequired(wrapReasonNow());
    }
  };

  const sendToolAck = (dc: RTCDataChannel, callId: string, output: unknown) => {
    // A frame can arrive as the channel is closing (teardown, cap, hang-up);
    // sending on a non-open channel throws, so skip rather than crash the turn.
    if (dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
  };

  // Fires a response.create, optionally overriding just this one response's
  // instructions (see the Realtime API's per-response instructions field) —
  // used to steer a single checklist question without touching the
  // session-level instructions set at call start.
  const sendResponse = (dc: RTCDataChannel, instructions?: string) => {
    if (dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "response.create",
        ...(instructions ? { response: { instructions } } : {}),
      }),
    );
  };

  // Auto-scroll the transcript when new text arrives, unless user has scrolled up
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container || !isAutoScrollEnabled) return;

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }, [displayTranscript, isAutoScrollEnabled]);

  // Clear transcript when a new session starts (when attempt increments).
  // This is an intentional synchronous state update: we need to clear the
  // transcript display when a new session starts, which is signaled by the
  // attempt counter incrementing. This is a valid side effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayTranscript([]);
    transcriptRef.current = [];
    setIsAutoScrollEnabled(true);
  }, [attempt]);

  useEffect(() => {
    // attempt 0 is the pre-permission explainer — don't mint a session or
    // touch the microphone until the contractor taps Start.
    if (attempt === 0) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const { jobId, clientSecret } = await createRealtimeSession();
        if (cancelled) return;
        jobIdRef.current = jobId;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micErr) {
          // Distinguish "mic denied/busy/missing" from a downstream connection
          // failure so the recovery screen can offer the right next step.
          if (cancelled) return;
          setMicFailure(classifyMicError(micErr));
          setCallState("error");
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        startLevelMonitoring(stream);

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        pc.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0] ?? null;
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          // Start the 6-minute hard cap from the moment the live call is
          // actually up — not from connect/permission time.
          sessionStartedAtRef.current = Date.now();
          updateCallState("listening");
          // Motko speaks first: kick off the opening assistant turn straight
          // away rather than waiting for the contractor to talk (semantic_vad
          // otherwise sits silent until it hears speech). The session
          // instructions tell it how to open — by name if known, else asking.
          sendResponse(dc);
        };

        dc.onmessage = (event) => {
          // Realtime frames are JSON, but a malformed/partial frame must not
          // throw out of this handler and kill the event loop — drop it.
          let data: {
            type: string;
            call_id?: string;
            name?: string;
            arguments?: string;
            transcript?: string;
          };
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }

          if (data.type === "input_audio_buffer.speech_started") {
            hasSpokenRef.current = true;
            lastSpeechAtRef.current = Date.now();
            workingCueFiredRef.current = false;
            stopRotatingMessages();
            if (callStateRef.current !== "finishing") updateCallState("listening");
          } else if (data.type === "response.created") {
            if (callStateRef.current !== "finishing") {
              fireWorkingCue();
              updateCallState("thinking");
              startRotatingMessages(THINKING_MESSAGES);
            }
          } else if (data.type === "response.output_audio.delta") {
            stopRotatingMessages();
            if (callStateRef.current !== "finishing") updateCallState("speaking");
          } else if (data.type === "response.function_call_arguments.done") {
            void handleToolCall(data.name ?? "", data.call_id ?? "", data.arguments ?? "{}");
          } else if (
            (data.type === "conversation.item.input_audio_transcription.completed" ||
              data.type === "response.output_audio_transcript.done") &&
            data.transcript
          ) {
            transcriptRef.current.push(data.transcript);
            setDisplayTranscript([...transcriptRef.current]);
            // Latch a spoken "that's it / that's everything" so the wrap
            // reason logs as 'user' even if the model, rather than the
            // heuristic, is what ultimately calls wrap_up. Only the
            // contractor's own words count, never the assistant's read-back.
            if (
              data.type === "conversation.item.input_audio_transcription.completed" &&
              userSignaledCompletion(data.transcript)
            ) {
              userDoneRef.current = true;
            }
          } else if (data.type === "response.done") {
            // Each completed assistant turn counts toward the hard question
            // cap (an upper bound — see questionsAskedRef). Enforce both hard
            // caps here so a model that never calls wrap_up still can't loop
            // forever: the call ends and prices from whatever's been gathered.
            questionsAskedRef.current += 1;
            if (wrapDetourActiveRef.current && !endedRef.current) {
              // Backstop for the compact wrap-up ask: if the contractor deflects
              // without an update_sow to conclude it (see the update_sow
              // handler), the turn bound ends the detour and drafts anyway.
              wrapDetourTurnsRef.current += 1;
              if (wrapDetourTurnsRef.current >= WRAP_DETOUR_MAX_TURNS) {
                concludeWrapDetour();
                return;
              }
              // Still going — the channel is alive, so push the inactivity
              // backstop out rather than firing it mid-conversation.
              armWrapDetourTimeout();
            } else if (!endedRef.current) {
              const elapsed = sessionStartedAtRef.current
                ? Date.now() - sessionStartedAtRef.current
                : 0;
              // Route caps through the same required-slot safety net as a manual
              // wrap: if a must-ask slot is still open, one compact detour asks
              // it before drafting (itself turn-bounded, so it can't reopen the
              // loop the cap exists to stop); otherwise it drafts immediately.
              if (questionsAskedRef.current >= MAX_ASSISTANT_QUESTIONS) {
                concludeOrAskRequired("cap_questions");
                return;
              }
              if (elapsed >= MAX_SESSION_MS) {
                concludeOrAskRequired("cap_time");
                return;
              }
            }
            if (callStateRef.current !== "finishing") {
              hasSpokenRef.current = false;
              workingCueFiredRef.current = false;
              stopRotatingMessages();
              updateCallState("listening");
            }
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            body: offer.sdp,
            headers: {
              Authorization: `Bearer ${clientSecret}`,
              "Content-Type": "application/sdp",
            },
          },
        );

        if (!sdpResponse.ok) {
          throw new Error("Couldn't connect the live call — try again.");
        }

        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't start the call — check your microphone permissions and try again.",
        );
        updateCallState("error");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
      stopRotatingMessages();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Kicks off (or retries) the live call: clears any prior failure and bumps
  // the attempt counter, which re-runs the connect effect above.
  const startCall = () => {
    setError(null);
    setMicFailure(null);
    setCallState("connecting");
    setAttempt((n) => n + 1);
  };

  // Typed-quote escape hatch, available from the explainer and every failure
  // state. Spins up an empty draft job and drops the contractor into the
  // quote editor — no microphone required.
  const goManual = () => {
    setManualPending(true);
    void (async () => {
      try {
        const { jobId } = await createManualJob();
        router.push(`/jobs/${jobId}`);
      } catch (err) {
        setManualPending(false);
        setError(
          err instanceof Error ? err.message : "Couldn't start a typed quote — try again.",
        );
      }
    })();
  };

  const toggleMute = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  // Handle scroll events to detect if user has scrolled up manually
  const handleTranscriptScroll = () => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    // Check if user is at the bottom (within 10px threshold)
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 10;

    setIsAutoScrollEnabled(isAtBottom);
  };

  const statusLabel: Record<CallState, string> = {
    connecting: "Connecting…",
    listening: "Listening — talk me through the job",
    thinking: "Got it — one sec…",
    speaking: "Speaking…",
    finishing: "Got it — drafting your quote…",
    error: "Something went wrong",
  };

  const displayStatus = rotatingText ?? statusLabel[callState];
  const hearingYou = callState === "listening" && micLevel > SPEECH_RMS_THRESHOLD;

  // Pre-permission explainer and mic-failure recovery live outside the live
  // call UI — the microphone is never requested until the contractor is on the
  // explainer and taps Start.
  if (attempt === 0 || micFailure) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader backHref="/" backLabel="Cancel" />
        <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          {/* Transcript container - empty on explainer screen, shows content on error */}
          <div
            ref={transcriptContainerRef}
            data-testid="voice-transcript"
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-3 text-sm"
            style={{ maxHeight: "200px", overflowY: "auto" }}
            onScroll={handleTranscriptScroll}
          >
            {displayTranscript.map((line, i) => (
              <div key={i} className="mb-2 last:mb-0">
                {line}
              </div>
            ))}
          </div>
          {micFailure ? (
            <MicFailureScreen
              kind={micFailure}
              onRetry={startCall}
              onManual={goManual}
              manualLabel="Type the quote in instead"
              manualPending={manualPending}
            />
          ) : (
            <MicExplainer
              intro="I'll say hello, then you talk me through the job — the rooms, the work, any materials — and I'll draft the quote for you. I'll ask to use your microphone next so I can hear you."
              startLabel="Start talking"
              starting={false}
              onStart={startCall}
              onManual={goManual}
              manualLabel="Type the quote in instead"
              manualPending={manualPending}
            />
          )}
          {error && <p className="text-sm text-error">{error}</p>}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/" backLabel="Cancel" />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {/* Live transcript display */}
        <div
          ref={transcriptContainerRef}
          data-testid="voice-transcript"
          className="w-full max-w-sm rounded-lg border border-border bg-surface p-3 text-sm"
          style={{ maxHeight: "200px", overflowY: "auto" }}
          onScroll={handleTranscriptScroll}
        >
          {displayTranscript.map((line, i) => (
            <div key={i} className="mb-2 last:mb-0">
              {line}
            </div>
          ))}
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">New job</h1>
            <p className="text-sm text-text-secondary" aria-live="polite">
              {callState === "finishing" && !pipelineFailed
                ? "Nearly there"
                : phase === "followup" && callState !== "finishing" && callState !== "error"
                  ? "Just a couple more things"
                  : displayStatus}
            </p>
          </div>

          {phase === "followup" && activeQuestion && callState !== "finishing" && (
            <Card className="flex w-full flex-col gap-1 text-center">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Quick question
              </h2>
              <p className="text-base font-medium">{CHECKLIST_QUESTIONS[activeQuestion]}</p>
            </Card>
          )}

          {sowState && sowState.rooms.length > 0 && (
            <Card className="flex w-full flex-col gap-2 text-sm">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Scope so far
              </h2>
              <ul className="flex flex-col gap-1">
                {sowState.rooms.map((room, i) => (
                  <li key={i}>
                    <span className="font-medium">{room.name}</span>
                    {room.dimensions ? ` (${room.dimensions})` : ""}
                    {room.work_items.length > 0 && (
                      <span className="text-text-secondary">
                        {" — "}
                        {room.work_items.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Live-call orb — only while the mic is actually live. The staged
              write-up/pricing screen and the failure screen replace it once
              the call wraps. */}
          {callState !== "finishing" && callState !== "error" && (
            <div className="relative flex h-32 w-32 items-center justify-center">
              {/* Expanding rings — the unmistakable "I'm listening" pulse, like
                  a voice assistant. Only animates while the mic is actually
                  live, and speeds up/brightens with real mic level so silence
                  is visibly, not just audibly, legible. */}
              {callState === "listening" && (
                <>
                  <span className="absolute inline-flex h-24 w-24 animate-ping rounded-full bg-accent opacity-40 [animation-duration:1.6s]" />
                  <span className="absolute inline-flex h-28 w-28 animate-ping rounded-full bg-accent opacity-20 [animation-duration:1.6s] [animation-delay:0.4s]" />
                </>
              )}
              <div
                className={`relative flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium text-accent-foreground transition-transform duration-100 ${
                  callState === "listening"
                    ? "bg-accent shadow-[0_0_28px_rgba(0,66,37,0.45)]"
                    : callState === "speaking"
                      ? "animate-pulse bg-accent"
                      : callState === "thinking"
                        ? "animate-pulse bg-accent/50"
                        : "bg-accent/50"
                }`}
                style={
                  callState === "listening"
                    ? { transform: `scale(${1.1 + Math.min(micLevel * 4, 0.35)})` }
                    : undefined
                }
                aria-live="polite"
              >
                {callState === "connecting"
                  ? "…"
                  : callState === "listening"
                    ? "Listening"
                    : callState === "speaking"
                      ? "Speaking"
                      : "Live"}
              </div>
            </div>
          )}

          {callState === "listening" && (
            <p className="-mt-4 text-xs text-text-secondary" aria-hidden="true">
              {hearingYou ? "Hearing you…" : "Go ahead…"}
            </p>
          )}

          {/* Manual wrap. The model calling wrap_up is no longer the only way
              out of the call: the contractor can end it themselves the instant
              they're done, so they never sit watching a live orb while the
              model dithers about wrapping. This routes through
              concludeOrAskRequired, not straight to teardown: if a must-ask slot
              (crew / pricing-mode / materials) is still open, one compact
              wrap-up question asks it before drafting — otherwise it ends the
              call immediately, same as before. */}
          {(callState === "listening" || callState === "speaking" || callState === "thinking") && (
            <div className="flex w-full max-w-xs flex-col items-center gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={() => concludeOrAskRequired("manual")}
                className="w-full"
              >
                Finish &amp; price it up
              </Button>
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            </div>
          )}

          {/* Staged write-up → pricing progress. Drafting kicks off
              automatically the instant the call wraps — no button to press —
              and the contractor watches the two stages tick before being taken
              straight to the quote. */}
          {callState === "finishing" && !pipelineFailed && (
            <div className="flex w-full flex-col gap-4" aria-live="polite">
              {FINISH_STAGES.map((label, i) => {
                const done = finishStage > i;
                const active = finishStage === i;
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        done
                          ? "bg-accent text-accent-foreground"
                          : active
                            ? "bg-accent/15 text-accent"
                            : "bg-surface-hover text-text-secondary"
                      }`}
                    >
                      {done ? (
                        "✓"
                      ) : active ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={`text-sm ${
                        active || done ? "font-medium" : "text-text-secondary"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Stall / failure recovery — nothing spoken is lost. Retry
              re-prices from the same transcript; Save and finish later persists
              it and steps away. */}
          {callState === "error" && pipelineFailed && (
            <div className="flex w-full flex-col items-center gap-4 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">This is taking longer than it should.</p>
                <p className="text-xs text-text-secondary">
                  Your job and everything you said are saved. Try pricing it again, or
                  come back to it later.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2">
                <Button type="button" variant="primary" onClick={retry}>
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={saveForLater}
                  disabled={savingForLater}
                >
                  {savingForLater ? "Saving…" : "Save and finish later"}
                </Button>
              </div>
            </div>
          )}

          {error && callState === "error" && !pipelineFailed && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
