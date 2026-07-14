"use client";

import { useEffect } from "react";
import { logClientError } from "@/lib/errors-client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logClientError("global_error_boundary", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: "0.25rem", color: "#666", fontSize: "0.875rem" }}>
            Sorry — that didn&apos;t work. Try again.
          </p>
        </div>
        <button
          onClick={() => reset()}
          style={{
            height: "2.75rem",
            padding: "0 1rem",
            borderRadius: "0.25rem",
            background: "#004225",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.875rem",
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
