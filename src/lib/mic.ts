import { isNativeApp } from "@/lib/platform";

// Why a voice quote needs the microphone fails in a handful of distinct ways,
// and each one needs a different recovery path. getUserMedia rejects with a
// DOMException whose `name` tells us which case we're in — classify it once
// here so the UI can show the right message and the right button instead of a
// generic "check your microphone permissions" catch-all.
export type MicFailureKind =
  | "denied" // user (or a prior "Don't Allow") refused permission
  | "in-use" // mic is busy — on a call, another app has it, or hardware error
  | "no-device" // no microphone hardware found
  | "insecure" // page isn't a secure context (no getUserMedia at all)
  | "unknown"; // anything we didn't anticipate

export const classifyMicError = (err: unknown): MicFailureKind => {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in-use";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-device";
    default:
      // getUserMedia itself missing (old browser / insecure origin) surfaces
      // as a plain TypeError, not a DOMException.
      if (err instanceof TypeError) return "insecure";
      return "unknown";
  }
};

type FailureCopy = {
  title: string;
  body: string;
  // Whether re-requesting the mic could plausibly succeed without the user
  // first changing something outside the app. A flat "denied" won't — they
  // have to flip the toggle in Settings — so retry is pointless there.
  canRetry: boolean;
};

export const micFailureCopy: Record<MicFailureKind, FailureCopy> = {
  denied: {
    title: "Microphone access is off",
    body: "Motko needs the microphone to hear you describe the job. Turn it on in Settings, then come back and start again.",
    canRetry: false,
  },
  "in-use": {
    title: "Your microphone is busy",
    body: "Something else is using the microphone — end any calls or close other apps using it, then try again.",
    canRetry: true,
  },
  "no-device": {
    title: "No microphone found",
    body: "We couldn't find a microphone on this device. You can type the quote in by hand instead.",
    canRetry: true,
  },
  insecure: {
    title: "Voice isn't available here",
    body: "Voice quotes need a secure connection. You can type the quote in by hand instead.",
    canRetry: false,
  },
  unknown: {
    title: "Couldn't start the microphone",
    body: "Something went wrong starting the microphone. Try again, or type the quote in by hand.",
    canRetry: true,
  },
};

// Deep-link the contractor to where they can flip the microphone permission
// back on. Inside the iOS shell that's the app's own row in Settings, reached
// via the app-settings: URL scheme; in a plain browser there's no equivalent,
// so we do nothing and the UI's written instructions take over.
export const openAppSettings = (): void => {
  if (!isNativeApp()) return;
  window.location.href = "app-settings:";
};

// Written fallback for when the deep link can't be relied on (or on the web).
// Kept beside the link so the two never drift apart.
export const settingsInstructions = "Open Settings, find Motko, then turn on Microphone.";
