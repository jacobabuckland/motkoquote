// Half-duplex microphone gate for the live voice intake.
//
// Bug: "When running a quote the voice skips to next question". On-device
// (iOS WKWebView) the speaker's TTS couples back into the hot microphone;
// the Realtime server's semantic_vad hears that echo as a user turn and
// interrupts, so the assistant appears to skip ahead. The fix is to stop
// feeding the mic to the connection while the assistant is speaking — a
// deliberately half-duplex call (no barge-in). A manual mute always wins.
//
// This is the deterministic, unit-testable core of the gate. The audible
// result can only be confirmed on a real device; this function only decides
// whether the mic track should be live for a given state.
export type MicGateInput = {
  muted: boolean;
  assistantSpeaking: boolean;
};

export const micShouldBeEnabled = ({ muted, assistantSpeaking }: MicGateInput): boolean =>
  !muted && !assistantSpeaking;
