"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSetupRealtimeSession, completeSetupConversation } from "../actions";
import { signOut } from "../../actions";
import {
  mergeBusinessSetupToolDelta,
  EMPTY_BUSINESS_SETUP_STATE,
  type BusinessSetupState,
} from "@/lib/schemas/business-setup";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

type CallState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "finishing"
  | "error";

type TranscriptEntry = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const MAX_TOOL_TURNS = 20;

// Voice-driven "set up your business" interview — same live speech-to-speech
// architecture as the job intake flow (see jobs/new/page.tsx and
// lib/realtime.ts): one direct WebRTC connection to OpenAI's Realtime API,
// tool calls merged deterministically client-side, a single write to
// Supabase at the end via completeSetupConversation.
export default function SetupVoicePage() {
  const router = useRouter();
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [setupState, setSetupState] = useState<BusinessSetupState>(
    EMPTY_BUSINESS_SETUP_STATE,
  );
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [micActive, setMicActive] = useState(false);

  const setupStateRef = useRef<BusinessSetupState>(EMPTY_BUSINESS_SETUP_STATE);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const toolTurnsRef = useRef(0);
  const endedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dcRef.current?.close();
    pcRef.current?.close();
  };

  const finishConversation = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("finishing");
    cleanup();

    try {
      const { redirectTo } = await completeSetupConversation({
        state: setupStateRef.current,
      });
      router.push(redirectTo);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong saving your details.",
      );
      setCallState("error");
    }
  };

  const handleToolCall = async (name: string, callId: string, argsJson: string) => {
    const dc = dcRef.current;
    if (!dc) return;

    if (name === "update_business_setup") {
      toolTurnsRef.current += 1;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        // Malformed args — ack with nothing captured rather than dropping
        // the conversation.
      }

      try {
        const updated = mergeBusinessSetupToolDelta(setupStateRef.current, parsedArgs);
        setupStateRef.current = updated;
        setSetupState(updated);
      } catch {
        // A single failed merge shouldn't kill the live conversation.
      }

      sendToolResult(dc, callId, { ok: true });

      if (toolTurnsRef.current >= MAX_TOOL_TURNS) {
        void finishConversation();
      }
      return;
    }

    if (name === "finish_setup") {
      sendToolResult(dc, callId, { ok: true });
      void finishConversation();
    }
  };

  const sendToolResult = (dc: RTCDataChannel, callId: string, output: unknown) => {
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
    dc.send(JSON.stringify({ type: "response.create" }));
  };

  const appendTranscriptDelta = (role: TranscriptEntry["role"], id: string, delta: string) => {
    if (!delta) return;
    setTranscript((prev) => {
      const existing = prev.find((entry) => entry.id === id);
      if (existing) {
        return prev.map((entry) =>
          entry.id === id ? { ...entry, text: entry.text + delta } : entry,
        );
      }
      return [...prev, { id, role, text: delta }];
    });
  };

  const finalizeTranscriptEntry = (id: string, finalText: string) => {
    if (!finalText) return;
    setTranscript((prev) =>
      prev.some((entry) => entry.id === id)
        ? prev.map((entry) => (entry.id === id ? { ...entry, text: finalText } : entry))
        : [...prev, { id, role: "assistant", text: finalText }],
    );
  };

  const addTranscriptEntry = (role: TranscriptEntry["role"], id: string, text: string) => {
    if (!text) return;
    setTranscript((prev) => [...prev, { id, role, text }]);
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        const { clientSecret, initialState } = await createSetupRealtimeSession();
        if (cancelled) return;
        setupStateRef.current = initialState;
        setSetupState(initialState);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
            item_id?: string;
            delta?: string;
            transcript?: string;
          };

          if (data.type === "input_audio_buffer.speech_started") {
            setCallState("listening");
            setMicActive(true);
          } else if (data.type === "input_audio_buffer.speech_stopped") {
            setMicActive(false);
          } else if (data.type === "response.created") {
            setCallState("thinking");
          } else if (data.type === "response.output_audio.delta") {
            setCallState("speaking");
          } else if (data.type === "response.output_audio_transcript.delta") {
            appendTranscriptDelta("assistant", data.item_id ?? "assistant", data.delta ?? "");
          } else if (data.type === "response.output_audio_transcript.done") {
            finalizeTranscriptEntry(data.item_id ?? "assistant", data.transcript ?? "");
          } else if (
            data.type === "conversation.item.input_audio_transcription.completed"
          ) {
            addTranscriptEntry("user", data.item_id ?? crypto.randomUUID(), data.transcript ?? "");
          } else if (data.type === "response.function_call_arguments.done") {
            void handleToolCall(data.name ?? "", data.call_id ?? "", data.arguments ?? "{}");
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
  }, []);

  const retry = () => {
    window.location.reload();
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
    listening: "Listening — tell me about your business",
    thinking: "Thinking…",
    speaking: "Speaking…",
    finishing: "Saving your details…",
    error: "Something went wrong",
  };

  const allFields: [string, string][] = [
    ["Company", setupState.company_name ?? ""],
    ["Trade", setupState.trade ?? ""],
    [
      "VAT",
      setupState.vat_registered === null
        ? ""
        : setupState.vat_registered
          ? `Registered${setupState.vat_number ? ` (${setupState.vat_number})` : ""}`
          : "Not registered",
    ],
    ["Day rate", setupState.day_rate ? `£${setupState.day_rate}` : ""],
    ["Overtime rate", setupState.overtime_rate ? `£${setupState.overtime_rate}` : ""],
    ["Call-out min", setupState.callout_min ? `£${setupState.callout_min}` : ""],
    ["Travel charge", setupState.travel_rate ? `£${setupState.travel_rate}` : ""],
    ["Materials markup", setupState.markup_pct ? `${setupState.markup_pct}%` : ""],
  ];
  const capturedFields = allFields.filter(([, value]) => value.length > 0);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        backHref="/setup"
        backLabel="Fill in manually instead"
        action={
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm text-text-secondary hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        }
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">Set up your business</h1>
            <p className="text-sm text-text-secondary">{statusLabel[callState]}</p>
          </div>

          {capturedFields.length > 0 && (
            <Card className="flex w-full flex-col gap-2 text-sm">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Captured so far
              </h2>
              <ul className="flex flex-col gap-1">
                {capturedFields.map(([label, value]) => (
                  <li key={label}>
                    <span className="font-medium">{label}:</span>{" "}
                    <span className="text-text-secondary">{value}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {setupState.notes.length > 0 && (
            <Card className="flex w-full flex-col gap-2 text-sm">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Notes
              </h2>
              <ul className="flex flex-col gap-1">
                {setupState.notes.map((note, index) => (
                  <li key={index} className="text-text-secondary">
                    {note}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium text-accent-foreground ${
                callState === "speaking" || callState === "listening"
                  ? "bg-accent"
                  : "bg-accent/50"
              } ${micActive ? "animate-pulse ring-4 ring-accent/40" : ""}`}
              aria-live="polite"
            >
              {callState === "connecting" || callState === "finishing" ? "…" : "Live"}
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
              <button
                type="button"
                onClick={() => void finishConversation()}
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                Done — save my details
              </button>
              <Link
                href="/setup"
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                I&apos;d rather fill it in manually
              </Link>
            </div>
          )}

          {transcript.length > 0 && (
            <Card className="flex w-full flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Conversation
              </h2>
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto text-sm">
                {transcript.map((entry) => (
                  <p
                    key={entry.id}
                    className={
                      entry.role === "assistant"
                        ? "text-text-secondary"
                        : "font-medium text-foreground"
                    }
                  >
                    <span className="font-medium">
                      {entry.role === "assistant" ? "Motko: " : "You: "}
                    </span>
                    {entry.text}
                  </p>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </Card>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                Try again
              </button>
              <Link
                href="/setup"
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                I&apos;d rather fill it in manually
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
