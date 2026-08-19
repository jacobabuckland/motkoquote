"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Loading your quotes",
  "Loading your contracts",
  "Loading your bills",
  "Loading your invoices",
];

const ROTATION_INTERVAL = 2000; // 2 seconds (within the 1.5-2.5s spec)

export default function Loading() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
    }, ROTATION_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ backgroundColor: "var(--green)" }}
    >
      {/* Wordmark */}
      <div className="mb-8 text-4xl font-bold tracking-tight text-white">
        motko
      </div>

      {/* Spinner */}
      <div className="mb-6">
        <svg
          aria-label="Loading"
          className="h-8 w-8 animate-spin motion-reduce:animate-none text-white"
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
      </div>

      {/* Rotating status message */}
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-white opacity-90"
      >
        {MESSAGES[messageIndex]}
      </div>
    </div>
  );
}
