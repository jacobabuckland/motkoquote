"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { processVoiceNote } from "../actions";

type RecordingState = "idle" | "recording" | "uploading" | "processing";

export default function NewJobPage() {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, startTransition] = useTransition();

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
        await processVoiceNote(path);
      } catch (err) {
        if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
        setError(err instanceof Error ? err.message : "Processing failed");
        setState("idle");
      }
    });
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-2xl font-semibold">New voice note</h1>

      {state === "idle" && (
        <button
          onClick={startRecording}
          className="bg-black text-white rounded-full h-20 w-20 flex items-center justify-center"
        >
          Rec
        </button>
      )}

      {state === "recording" && (
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={stopRecording}
            className="bg-red-600 text-white rounded-full h-20 w-20 flex items-center justify-center"
          >
            Stop
          </button>
          <p className="text-sm text-neutral-500">{seconds}s</p>
        </div>
      )}

      {(state === "uploading" || state === "processing" || isPending) && (
        <p className="text-sm text-neutral-500">
          {state === "uploading"
            ? "Uploading..."
            : "Transcribing and drafting your quote — this can take a moment..."}
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
