"use client";

import { useLayoutEffect, useState } from "react";

const MESSAGES = [
  "Loading your quotes",
  "Loading your contracts",
  "Loading your bills",
];

const ROTATION_INTERVAL = 2000; // 2 seconds (within 1.5-2.5s range)

const Spinner = () => (
  <svg
    role="status"
    className="h-8 w-8 animate-spin text-white"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export const AppLoadingScreen = () => {
  const [messageIndex, setMessageIndex] = useState(0);

  useLayoutEffect(() => {
    let cancelled = false;

    const scheduleNext = () => {
      setTimeout(() => {
        if (!cancelled) {
          setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
          scheduleNext();
        }
      }, ROTATION_INTERVAL);
    };

    scheduleNext();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-green">
      <div className="flex flex-col items-center gap-6">
        {/* Lowercase motko wordmark */}
        <h1 className="text-4xl font-bold text-white">motko</h1>

        {/* Loading spinner */}
        <Spinner />

        {/* Rotating status message */}
        <p className="text-sm text-white/90">{MESSAGES[messageIndex]}</p>
      </div>
    </div>
  );
};
