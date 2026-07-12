"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { advanceSowConversation, getGreeting } from "../actions";
import type { SowState } from "@/lib/schemas/sow";
import { Card } from "@/components/ui/card";

type RecordingState = "idle" | "recording" | "uploading" | "processing";

const FALLBACK_QUESTION =
  "Talk me through the job — rooms, work, and anything tricky about access.";

export default function NewJobPage() {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, startTransition] = useTransition();

  const [jobId, setJobId] = useState<string | null>(null);
  const [sowState, setSowState] = useState<SowState | null>(null);
  const [question, setQuestion] = useState(FALLBACK_QUESTION);
  const [turn, setTurn] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [questionAudio, setQuestionAudio] = useState<string | null>(null);

  const playAudio = (src: string) => {
    if (!audioRef.current) return;
    audioRef.current.src = src;
    void audioRef.current.play().catch(() => {
      // Autoplay blocked (common on mobile before a direct tap on the audio
      // itself) — the "Hear question" button lets the contractor trigger it.
    });
  };

  useEffect(() => {
    let cancelled = false;
    void getGreeting().then(({ question: greeting, audio }) => {
      if (cancelled) return;
      setQuestion(greeting);
      if (audio) setQuestionAudio(audio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        void handleUpload(new Blob(chunksRef.current, { type: "audio/webm" }));
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const handleUpload = async (blob: Blob) => {
    setState("uploading");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in.");
      setState("idle");
      return;
    }

    const path = `${user.id}/${Date.now()}.webm`;
    const { error: uploadError } = await supabase.storage
      .from("voice-notes")
      .upload(path, blob, { contentType: "audio/webm" });

    if (uploadError) {
      setError(uploadError.message);
      setState("idle");
      return;
    }

    setState("processing");
    startTransition(async () => {
      try {
        const result = await advanceSowConversation({ jobId, storagePath: path });
        setJobId(result.jobId);
        setSowState(result.sowState);
        setQuestion(result.nextQuestion);
        setTurn((t) => t + 1);
        setState("idle");
        if (result.questionAudio) {
          setQuestionAudio(result.questionAudio);
          playAudio(result.questionAudio);
        } else {
          setQuestionAudio(null);
        }
      } catch (err) {
        if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
        setError(err instanceof Error ? err.message : "Processing failed");
        setState("idle");
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-sm text-text-secondary hover:text-foreground">
          ← Cancel
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">
              {turn === 0 ? "New job" : "Tell me more"}
            </h1>
            <p className="text-sm text-text-secondary">{question}</p>
            {questionAudio && (
              <button
                type="button"
                onClick={() => playAudio(questionAudio)}
                className="text-sm text-accent underline underline-offset-4"
              >
                🔊 Hear question
              </button>
            )}
          </div>
          <audio ref={audioRef} className="hidden" />

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

          {state === "idle" && (
            <button
              onClick={startRecording}
              aria-label="Start recording"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Rec
            </button>
          )}

          {state === "recording" && (
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={stopRecording}
                aria-label="Stop recording"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-error text-sm font-medium text-accent-foreground"
              >
                Stop
              </button>
              <p className="tabular-nums text-sm text-text-secondary">{seconds}s</p>
            </div>
          )}

          {(state === "uploading" || state === "processing" || isPending) && (
            <p className="text-sm text-text-secondary">
              {state === "uploading"
                ? "Uploading..."
                : "Thinking about what to ask next..."}
            </p>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </main>
    </div>
  );
}
