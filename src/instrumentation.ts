/**
 * Server-side instrumentation. Next.js calls `register()` once per server
 * instance, and `onRequestError` for every error the server captures.
 *
 * `onRequestError` is the hook that makes this worth doing: it fires for
 * server components, route handlers AND server actions, which is the whole
 * server surface of this app in one place. Before it, a server action that
 * threw — sending a quote, creating an invoice, settling a payment — produced
 * a digest in the Vercel log and nothing else.
 */
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
};

export const onRequestError: Instrumentation.onRequestError = Sentry.captureRequestError;
