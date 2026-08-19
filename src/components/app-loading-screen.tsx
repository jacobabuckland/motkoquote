"use client";

import { useEffect, useState } from "react";

const LOADING_MESSAGES = [
  "Loading your quotes",
  "Loading your contracts",
  "Loading your bills",
];

export default function AppLoadingScreen() {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  useEffect(() => {
    let count = 0;

    const intervalId = setInterval(() => {
      count++;

      // Safety limit to prevent infinite loops in tests
      // (vi.runAllTimersAsync runs intervals recursively).
      // In production, the parent component unmounts this when the app is ready.
      if (count > 200) {
        clearInterval(intervalId);
        return;
      }

      setCurrentMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      data-testid="app-loading-screen"
      className="fixed inset-0 flex items-center justify-center flex-col gap-6 z-50"
      style={{ backgroundColor: "#004225" }}
    >
      {/* Wordmark */}
      <div className="text-white text-4xl font-semibold">motko</div>

      {/* Spinner */}
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin"
      />

      {/* Rotating status message */}
      <div className="text-white/80 text-sm" aria-hidden="true">
        {LOADING_MESSAGES[currentMessageIndex]}
      </div>
    </div>
  );
}
