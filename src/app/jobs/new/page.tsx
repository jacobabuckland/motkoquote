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
  type SowState,
  type ChecklistQuestionId,
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
  // Mirrors sowState/phase/activeQuestion synchronously for use inside
  // handleToolCall/askNextQuestion, which run from WebRTC data-channel
  // callbacks and would otherwise close over stale state.
  const sowStateRef = useRef<SowState | null>(null);
  const phaseRef = useRef<Phase>("description");
  const activeQuestionRef = useRef<ChecklistQuestionId | null>(null);
  const followupQueueRef = useRef<ChecklistQuestionId[]>([]);
  const questionAttemptsRef = useRef(0);

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dcRef.current?.close();
    pcRef.current?.close();
  };

  const draftQuote = async () => {
    const jobId = jobIdRef.current;
    if (!jobId) {
      setError("Lost track of the job — try recording again.");
      setCallState("error");
      return;
    }

    setError(null);
    setCallState("finishing");
    try {
      await completeSowConversation({
        jobId,
        transcript: transcriptRef.current.join("\n"),
      });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      // The conversation is already captured server-side — surface the
      // failure with a retry that re-drafts from the same transcript rather
      // than dead-ending or forcing them to re-record everything.
      setError(
        err instanceof Error ? err.message : "Something went wrong drafting the quote.",
      );
      setCallState("error");
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
      void finishConversation();
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
      void finishConversation();
      return;
    }
    followupQueueRef.current = unanswered;
    phaseRef.current = "followup";
    setPhase("followup");
    askNextQuestion();
  };

  const finishConversation = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("finishing");
    cleanup();
    await draftQuote();
  };

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
        void finishConversation();
      }
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

  // "Skip" — move to the next unanswered question (or finish) without
  // waiting for a spoken answer to this one.
  const skipCurrentQuestion = () => {
    askNextQuestion();
  };

  // "Skip all — draft it anyway" — abandon the rest of the checklist and
  // draft the quote from whatever was gathered, same as if none of the
  // follow-ups had been asked.
  const skipAllQuestions = () => {
    followupQueueRef.current = [];
    void finishConversation();
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

        dc.onopen = () => setCallState("listening");

        dc.onmessage = (event) => {
          const data = JSON.parse(event.data) as {
            type: string;
            call_id?: string;
            name?: string;
            arguments?: string;
            transcript?: string;
          };

          if (data.type === "input_audio_buffer.speech_started") {
            setCallState("listening");
          } else if (data.type === "response.created") {
            setCallState("thinking");
          } else if (data.type === "response.output_audio.delta") {
            setCallState("speaking");
          } else if (data.type === "response.function_call_arguments.done") {
            void handleToolCall(data.name ?? "", data.call_id ?? "", data.arguments ?? "{}");
          } else if (
            (data.type === "conversation.item.input_audio_transcription.completed" ||
              data.type === "response.output_audio_transcript.done") &&
            data.transcript
          ) {
            transcriptRef.current.push(data.transcript);
          } else if (data.type === "response.done") {
            setCallState((prev) => (prev === "finishing" ? prev : "listening"));
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
        setCallState("error");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
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
    thinking: "Thinking…",
    speaking: "Speaking…",
    finishing: "Drafting your quote…",
    error: "Something went wrong",
  };

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
            <p className="text-sm text-text-secondary">
              {phase === "followup" && callState !== "finishing" && callState !== "error"
                ? "Just a couple more things"
                : statusLabel[callState]}
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
                voice assistant. Only animates while the mic is actually live. */}
            {callState === "listening" && (
              <>
                <span className="absolute inline-flex h-24 w-24 animate-ping rounded-full bg-accent opacity-40 [animation-duration:1.6s]" />
                <span className="absolute inline-flex h-28 w-28 animate-ping rounded-full bg-accent opacity-20 [animation-duration:1.6s] [animation-delay:0.4s]" />
              </>
            )}
            <div
              className={`relative flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium text-accent-foreground transition-transform duration-300 ${
                callState === "listening"
                  ? "scale-110 bg-accent shadow-[0_0_28px_rgba(0,66,37,0.45)]"
                  : callState === "speaking"
                    ? "animate-pulse bg-accent"
                    : "bg-accent/50"
              }`}
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

          {(callState === "listening" || callState === "speaking" || callState === "thinking") && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              {phase === "followup" ? (
                <>
                  <button
                    type="button"
                    onClick={skipCurrentQuestion}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={skipAllQuestions}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
                  >
                    Skip all — draft it anyway
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => maybeStartFollowups()}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
                >
                  Done — get my quote
                </button>
              )}
            </div>
          )}

          {error && callState === "error" && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={() => void draftQuote()}
                className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
              >
                Try drafting again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
