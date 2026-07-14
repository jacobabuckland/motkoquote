"use client";

import { useEffect } from "react";
import { logClientError } from "@/lib/errors-client";

/**
 * Global window-level error capture. Mounted once in the root layout so
 * uncaught errors and unhandled promise rejections anywhere in the client tree
 * are logged (deduped) to client_errors. Renders nothing.
 */
export const ErrorListener = () => {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logClientError("window_onerror", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      logClientError("unhandledrejection", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
};
