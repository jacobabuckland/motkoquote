"use client";

import { useEffect, useRef, useState } from "react";
import {
  classifyRealtimeConnectFailure,
  realtimeConnectFailureContext,
} from "@/lib/realtime-connect-failure";
import { reportRealtimeConnectFailure } from "@/app/actions";
import type { CostIntakeAdapter, DraftedCost } from "@/components/voice/cost-intake-adapter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { classifyMicError, type MicFailureKind } from "@/lib/mic";
import {
  createAssistantAudioHold,
  micShouldBeEnabled,
  type AssistantAudioHold,
} from "@/lib/voice-gate";
import { MicExplainer, MicFailureScreen } from "@/components/voice/mic-permission-screen";
import * as haptics from "@/lib/haptics";
import { buildDraftFromToolArgs, type DraftCostToolArgs } from "@/lib/voice/draft-cost";
import type { JobSummary } from "@/lib/match-job";

type CallState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirming"
  | "saving"
  | "error";

const MAX_SESSION_MS = 120_000; // 2-minute hard cap
const AUDIO_SAMPLE_MS = 80;

const THINKING_MESSAGES = ["Got it — one sec…", "Thinking it through…"];

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

/**
 * Voice cost capture component.
 *
 * Parallel to JobIntake but scoped to capturing a single cost:
 * - Amount (parsed deterministically from transcript)
 * - Counterparty (who/where)
 * - Category (inferred)
 * - Job (matched)
 *
 * Architecture:
 * - WebRTC connection to OpenAI Realtime API
 * - Live transcript display
 * - Confirmation screen before write
 */
export const CostIntake = ({ adapter }: { adapter: CostIntakeAdapter }) => {
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [rotatingText, setRotatingText] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [micFailure, setMicFailure] = useState<MicFailureKind | null>(null);
  const [draftedCost, setDraftedCost] = useState<DraftedCost | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const sessionKeyRef = useRef<string | null>(null);
  // The contractor's jobs, for the deterministic matcher (#274). A ref rather
  // than state because the tool handler reads it and nothing renders from it —
  // state here would re-render the call surface for data no pixel depends on.
  const jobsRef = useRef<JobSummary[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const transcriptRef = useRef<string[]>([]);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(false);
  const sessionStartedAtRef = useRef(0);
  const callStateRef = useRef<CallState>("connecting");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smoothedLevelRef = useRef(0);
  const hasSpokenRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const workingCueFiredRef = useRef(false);

  // Keeps the mic shut through the assistant's speech, driven by the output
  // audio buffer rather than by callState. This surface still carried the
  // pre-#210 formulation — `assistantSpeaking: callState === "speaking"` — and
  // that was inert for the same reason job-intake's was: "speaking" was only
  // ever set from a `response.output_audio.delta` handler, and that event is
  // never emitted over WebRTC. So this gate had never closed either. See #369.
  const holdRef = useRef<AssistantAudioHold | null>(null);
  const assistantAudioHold = (): AssistantAudioHold => {
    holdRef.current ??= createAssistantAudioHold(() => applyMicGate());
    return holdRef.current;
  };

  const applyMicGate = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const enabled = micShouldBeEnabled({
      muted: mutedRef.current,
      assistantSpeaking: holdRef.current?.assistantSpeaking() ?? false,
    });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  const updateCallState = (next: CallState) => {
    callStateRef.current = next;
    setCallState(next);
    applyMicGate();
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
    rotatingTimerRef.current = setTimeout(tick, 5000);
  };

  const fireWorkingCue = () => {
    if (workingCueFiredRef.current) return;
    workingCueFiredRef.current = true;

    haptics.tap();

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
    } catch {
      // Audio cue is cosmetic — if it fails, continue without it.
    }
  };

  const cleanup = () => {
    // The hold is call-scoped: a pending release timer must not outlive this
    // session and fire against the next one's mic track.
    holdRef.current?.clear();
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
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
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      levelIntervalRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const normalized = (buffer[i]! - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        smoothedLevelRef.current = smoothedLevelRef.current * 0.7 + rms * 0.3;
        setMicLevel(smoothedLevelRef.current);
      }, AUDIO_SAMPLE_MS);
    } catch {
      // Level monitoring is cosmetic — if it fails, continue without it.
    }
  };

  const sendResponse = (dc: RTCDataChannel) => {
    dc.send(JSON.stringify({ type: "response.create" }));
  };

  const handleToolCall = async (
    name: string,
    callId: string,
    argsJson: string,
  ) => {
    const dc = dcRef.current;
    if (!dc || endedRef.current) return;

    try {
      if (name === "draft_cost") {
        const args = JSON.parse(argsJson) as DraftCostToolArgs;

        // Amount AND job are both computed here from the contractor's own
        // words. The model has no field in which to supply a figure and none in
        // which to supply a job id, so neither the number nor the job shown for
        // confirmation is one a model asserted (#258, #274).
        const outcome = buildDraftFromToolArgs(
          args,
          new Date().toISOString().split("T")[0]!,
          jobsRef.current,
        );

        if (!outcome.ok) {
          dc.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify({ success: false, error: outcome.error }),
              },
            }),
          );
          sendResponse(dc);
          return;
        }

        const draft = outcome.draft;

        setDraftedCost(draft);
        updateCallState("confirming");
        endedRef.current = true;
        cleanup();

        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ success: true }),
            },
          }),
        );
      }
    } catch (err) {
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        }),
      );
      sendResponse(dc);
    }
  };

  const finishAndDraft = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    cleanup();
    // If no draft was captured, show error
    if (!draftedCost) {
      setError("No cost was captured — try again.");
      updateCallState("error");
    }
  };

  const confirmCost = async () => {
    if (!draftedCost) return;
    setIsSaving(true);
    try {
      await withTimeout(adapter.complete(draftedCost), 30000);
      // adapter.complete redirects on success, so we shouldn't reach here
    } catch (err) {
      setIsSaving(false);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save the cost — try again.",
      );
      updateCallState("error");
    }
  };

  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container || !isAutoScrollEnabled) return;
    container.scrollTop = container.scrollHeight;
  }, [transcript, isAutoScrollEnabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTranscript([]);
    transcriptRef.current = [];
    setIsAutoScrollEnabled(true);
    setDraftedCost(null);
  }, [attempt]);

  useEffect(() => {
    if (attempt === 0) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const { sessionKey, clientSecret, jobs } = await adapter.startSession();
        if (cancelled) return;
        sessionKeyRef.current = sessionKey;
        jobsRef.current = jobs ?? [];

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (micErr) {
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
          sessionStartedAtRef.current = Date.now();
          updateCallState("listening");
          sendResponse(dc);
        };

        dc.onmessage = (event) => {
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
            if (callStateRef.current !== "confirming") updateCallState("listening");
          } else if (data.type === "response.created") {
            if (callStateRef.current !== "confirming") {
              fireWorkingCue();
              updateCallState("thinking");
              startRotatingMessages(THINKING_MESSAGES);
            }
          } else if (data.type === "output_audio_buffer.started") {
            stopRotatingMessages();
            assistantAudioHold().beginAssistantAudio();
            if (callStateRef.current !== "confirming") updateCallState("speaking");
          } else if (
            data.type === "output_audio_buffer.stopped" ||
            data.type === "output_audio_buffer.cleared"
          ) {
            assistantAudioHold().endAssistantAudio();
            // Defers to the audio buffer while one is playing — response.done
            // is generation finishing, not playback. See job-intake and #369.
            if (
              callStateRef.current !== "confirming" &&
              !(holdRef.current?.assistantSpeaking() ?? false)
            ) {
              hasSpokenRef.current = false;
              workingCueFiredRef.current = false;
              stopRotatingMessages();
              updateCallState("listening");
            }
          } else if (data.type === "response.function_call_arguments.done") {
            void handleToolCall(
              data.name ?? "",
              data.call_id ?? "",
              data.arguments ?? "{}",
            );
          } else if (
            (data.type === "conversation.item.input_audio_transcription.completed" ||
              data.type === "response.output_audio_transcript.done") &&
            data.transcript
          ) {
            transcriptRef.current.push(data.transcript);
            setTranscript([...transcriptRef.current]);
          } else if (data.type === "response.done") {
            // Check session timeout
            const elapsed = sessionStartedAtRef.current
              ? Date.now() - sessionStartedAtRef.current
              : 0;
            if (elapsed >= MAX_SESSION_MS) {
              finishAndDraft();
              return;
            }
            if (callStateRef.current !== "confirming") {
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
          // The status and body are the only thing that says WHY. A rate limit, a
          // spent quota, a revoked key and a rejected SDP are indistinguishable
          // without them, and only one of the four is worth retrying.
          const detail = await sdpResponse.text().catch(() => "");
          const failure = classifyRealtimeConnectFailure(sdpResponse.status, detail);
          // Report it. Before this, a total voice outage produced no server-side
          // evidence at all — the first indication was a contractor getting in touch.
          void reportRealtimeConnectFailure(
            realtimeConnectFailureContext(failure, "cost-intake"),
          );
          throw new Error(failure.message);
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

  const startCall = () => {
    setError(null);
    setMicFailure(null);
    setCallState("connecting");
    setAttempt((prev) => prev + 1);
  };

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    applyMicGate();
  };

  const handleDone = () => {
    finishAndDraft();
  };

  if (attempt === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          backHref={adapter.backHref}
          backLabel={adapter.backLabel}
          action={adapter.headerAction}
        />
        <main className="flex flex-1 items-center justify-center p-6">
          <MicExplainer
            intro="Tell Motko about the cost — what you bought, how much, and which job it's for"
            startLabel="Start recording"
            onStart={startCall}
          />
        </main>
      </div>
    );
  }

  if (callState === "error" && micFailure) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          backHref={adapter.backHref}
          backLabel={adapter.backLabel}
          action={adapter.headerAction}
        />
        <main className="flex flex-1 items-center justify-center p-6">
          <MicFailureScreen kind={micFailure} onRetry={startCall} />
        </main>
      </div>
    );
  }

  if (callState === "confirming" && draftedCost) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          backHref={adapter.backHref}
          backLabel={adapter.backLabel}
          action={adapter.headerAction}
        />
        <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <div className="w-full max-w-sm">
            <h1 className="mb-6 text-center text-2xl font-semibold">
              Review and confirm
            </h1>

            <Card className="mb-6 p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium text-text-secondary">Amount</div>
                  <div className="text-lg">
                    £{(draftedCost.amountPence / 100).toFixed(2)}
                  </div>
                  {draftedCost.amountWords && (
                    <div className="text-sm text-text-secondary">
                      {draftedCost.amountWords}
                    </div>
                  )}
                </div>

                {draftedCost.counterpartyName && (
                  <div>
                    <div className="font-medium text-text-secondary">
                      Counterparty
                    </div>
                    <div>{draftedCost.counterpartyName}</div>
                  </div>
                )}

                <div>
                  <div className="font-medium text-text-secondary">
                    Category
                  </div>
                  <div className="capitalize">
                    {draftedCost.category.replace("_", " ")}
                  </div>
                </div>

                <div>
                  <div className="font-medium text-text-secondary">Job</div>
                  <div>{draftedCost.jobDisplay}</div>
                </div>

                <div>
                  <div className="font-medium text-text-secondary">
                    Description
                  </div>
                  <div>{draftedCost.description}</div>
                </div>

                <div>
                  <div className="font-medium text-text-secondary">Date</div>
                  <div>{draftedCost.incurredOn}</div>
                </div>
              </div>
            </Card>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  // Navigate to job page with drafted cost data for manual editing
                  const params = new URLSearchParams({
                    editDraft: "true",
                    amountPence: String(draftedCost.amountPence),
                    counterpartyName: draftedCost.counterpartyName ?? "",
                    category: draftedCost.category,
                    incurredOn: draftedCost.incurredOn,
                    description: draftedCost.description,
                  });
                  window.location.href = `/jobs/${draftedCost.jobId}?${params.toString()}`;
                }}
                className="flex-1"
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void confirmCost()}
                disabled={isSaving}
                className="flex-1"
              >
                {isSaving ? "Saving…" : "Confirm and save"}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const statusLabel: Record<CallState, string> = {
    connecting: "Connecting…",
    listening: "Listening — tell me about the cost",
    thinking: "Got it — one sec…",
    speaking: "Speaking…",
    confirming: "Review and confirm",
    saving: "Saving…",
    error: "Something went wrong",
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        backHref={adapter.backHref}
        backLabel={adapter.backLabel}
        action={adapter.headerAction}
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {/* Live transcript display */}
        <div
          ref={transcriptContainerRef}
          data-testid="voice-transcript"
          className="w-full max-w-sm rounded-lg border border-border bg-surface p-3 text-sm"
          style={{ maxHeight: "200px", overflowY: "auto" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const isAtBottom =
              Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
            setIsAutoScrollEnabled(isAtBottom);
          }}
        >
          {transcript.map((line, i) => (
            <div key={i} className="mb-2 last:mb-0">
              {line}
            </div>
          ))}
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">Add cost</h1>
            <p className="text-sm text-text-secondary" aria-live="polite">
              {rotatingText ?? statusLabel[callState]}
            </p>
          </div>

          {callState === "error" && error && (
            <Card className="w-full p-4">
              <p className="mb-3 text-sm text-error">{error}</p>
              {adapter.failureBody && (
                <p className="mb-3 text-sm text-text-secondary">
                  {adapter.failureBody}
                </p>
              )}
              <Button
                type="button"
                variant="primary"
                onClick={startCall}
                className="w-full"
              >
                Try again
              </Button>
            </Card>
          )}

          {/* Voice orb with mic level visualization */}
          <div className="relative flex h-32 w-32 items-center justify-center">
            {callState === "listening" && (
              <div
                className="absolute inset-0 rounded-full bg-accent opacity-30 transition-transform"
                style={{
                  transform: `scale(${1 + micLevel * 2})`,
                }}
              />
            )}
            <div
              className={`relative flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium ${
                muted
                  ? "bg-gray-400 text-gray-700"
                  : "bg-accent text-accent-foreground"
              }`}
            >
              {callState === "connecting"
                ? "…"
                : callState === "listening"
                  ? "Listening"
                  : callState === "thinking"
                    ? "Thinking"
                    : callState === "speaking"
                      ? "Speaking"
                      : "Ready"}
            </div>
          </div>

          {(callState === "listening" || callState === "speaking") && (
            <div className="flex w-full gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={toggleMute}
                className="flex-1"
              >
                {muted ? "Unmute" : "Mute"}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleDone}
                className="flex-1"
              >
                Done speaking
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
