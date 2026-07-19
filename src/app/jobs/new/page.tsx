"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRealtimeSession,
  saveSowDelta,
  completeSowConversation,
  createManualJob,
} from "../actions";
import {
  EMPTY_SOW_STATE,
  CHECKLIST_QUESTIONS,
  getUnansweredChecklistQuestions,
  resolveWrapReason,
  userSignaledCompletion,
  MAX_ASSISTANT_QUESTIONS,
  MAX_SESSION_MS,
  type SowState,
  type ChecklistQuestionId,
  type WrapReason,
} from "@/lib/schemas/sow";
import { Card } from "@/components/ui/card";
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
const FINISHING_MESSAGES = [
  "Got it — drafting your quote…",
  "Pricing it up…",
  "Putting the details together…",
  "Almost there…",
];

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

  const jobIdRef = useRef<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const toolTurnsRef = useRef(0);
  const transcriptRef = useRef<string[]>([]);
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
  // Mirrors sowState/phase/activeQuestion synchronously for use inside
  // handleToolCall/askNextQuestion, which run from WebRTC data-channel
  // callbacks and would otherwise close over stale state.
  const sowStateRef = useRef<SowState | null>(null);
  const phaseRef = useRef<Phase>("description");
  const activeQuestionRef = useRef<ChecklistQuestionId | null>(null);
  const followupQueueRef = useRef<ChecklistQuestionId[]>([]);
  const questionAttemptsRef = useRef(0);

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
    stopLevelMonitoring();
  };

  const draftQuote = async () => {
    const jobId = jobIdRef.current;
    if (!jobId) {
      stopRotatingMessages();
      setError("Lost track of the job — try recording again.");
      updateCallState("error");
      return;
    }

    setError(null);
    setCallState("finishing");
    try {
      await completeSowConversation({
        jobId,
        transcript: transcriptRef.current.join("\n"),
        wrapReason: wrapReasonRef.current,
        questionsAsked: questionsAskedRef.current,
      });
      stopRotatingMessages();
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      // The conversation is already captured server-side — surface the
      // failure with a retry that re-drafts from the same transcript rather
      // than dead-ending or forcing them to re-record everything.
      stopRotatingMessages();
      setError(
        err instanceof Error ? err.message : "Something went wrong drafting the quote.",
      );
      updateCallState("error");
    }
  };

  // Retries completeSowConversation without re-recording anything — the
  // transcript and job id are already sitting in refs, untouched by the
  // failure, so a flaky network call is a "try again", not a "start over".
  const retry = () => {
    setError(null);
    if (jobIdRef.current && transcriptRef.current.length > 0) {
      endedRef.current = false;
      void finishConversation(wrapReasonRef.current);
    } else {
      window.location.reload();
    }
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

  // Pops and asks the next unanswered checklist question over the same
  // live call, or finishes the conversation once the queue is empty.
  const askNextQuestion = () => {
    const dc = dcRef.current;
    const nextId = followupQueueRef.current.shift();
    if (!nextId || !dc) {
      void finishConversation(wrapReasonNow());
      return;
    }
    questionAttemptsRef.current = 0;
    activeQuestionRef.current = nextId;
    setActiveQuestion(nextId);
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

  const finishConversation = async (reason: WrapReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    wrapReasonRef.current = reason;
    workingCueFiredRef.current = true;
    fireWorkingCue();
    updateCallState("finishing");
    cleanup();
    startRotatingMessages(FINISHING_MESSAGES);
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
        void finishConversation(wrapReasonNow());
      }
      return;
    }

    // The model's clean-conclusion tool (Task 3): it decided there's nothing
    // left worth asking, or the contractor said they're done. Always ends the
    // call — never loops back into follow-ups — so conclusion is a designed
    // state rather than something the contractor has to force with the button.
    if (name === "wrap_up") {
      sendToolAck(dc, callId, { ok: true });
      void finishConversation(wrapReasonNow());
    }
  };

  const sendToolAck = (dc: RTCDataChannel, callId: string, output: unknown) => {
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
    dc.send(
      JSON.stringify({
        type: "response.create",
        ...(instructions ? { response: { instructions } } : {}),
      }),
    );
  };

  // The single manual escape hatch — "Finish and price it". Ends the call and
  // drafts from whatever's been gathered so far, in either phase; anything
  // still unknown flows to assumptions, exactly as a model-driven wrap-up
  // does. Replaces the old three-way Done/Skip/Skip-all tangle.
  const finishAndPrice = () => {
    followupQueueRef.current = [];
    void finishConversation("manual");
  };

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
        };

        dc.onmessage = (event) => {
          const data = JSON.parse(event.data) as {
            type: string;
            call_id?: string;
            name?: string;
            arguments?: string;
            transcript?: string;
          };

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
            if (!endedRef.current) {
              const elapsed = sessionStartedAtRef.current
                ? Date.now() - sessionStartedAtRef.current
                : 0;
              if (questionsAskedRef.current >= MAX_ASSISTANT_QUESTIONS) {
                void finishConversation("cap_questions");
                return;
              }
              if (elapsed >= MAX_SESSION_MS) {
                void finishConversation("cap_time");
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
              intro="Talk me through the job — the rooms, the work, any materials — and I'll draft the quote for you. I'll ask to use your microphone next so I can hear you."
              startLabel="Start voice quote"
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
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">New job</h1>
            <p className="text-sm text-text-secondary" aria-live="polite">
              {phase === "followup" && callState !== "finishing" && callState !== "error"
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

          <div className="relative flex h-32 w-32 items-center justify-center">
            {/* Expanding rings — the unmistakable "I'm listening" pulse, like a
                voice assistant. Only animates while the mic is actually live,
                and speeds up/brightens with real mic level so silence is
                visibly, not just audibly, legible. */}
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
                    : callState === "thinking" || callState === "finishing"
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
              {callState === "connecting" || callState === "finishing"
                ? "…"
                : callState === "listening"
                  ? "Listening"
                  : callState === "speaking"
                    ? "Speaking"
                    : "Live"}
            </div>
          </div>

          {callState === "listening" && (
            <p className="-mt-4 text-xs text-text-secondary" aria-hidden="true">
              {hearingYou ? "Hearing you…" : "Go ahead…"}
            </p>
          )}

          {(callState === "listening" || callState === "speaking" || callState === "thinking") && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={finishAndPrice}
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                Finish and price it
              </button>
            </div>
          )}

          {error && callState === "error" && (
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
