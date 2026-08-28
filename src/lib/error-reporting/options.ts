/**
 * One set of Sentry options, shared by the four runtimes that initialise it
 * (server, edge, client, and the instrumentation hook). Kept in one place
 * because the runtimes drift otherwise, and a scrubber applied on three of
 * four is a scrubber that does not work.
 */
import { scrubEvent } from "./scrub";

/**
 * The DSN is `NEXT_PUBLIC_` because the browser needs it to report at all. It
 * is designed to be public — it is a write-only ingest endpoint, not a
 * credential — so publishing it in the client bundle discloses nothing. The
 * value that IS secret is SENTRY_AUTH_TOKEN, which is build-time only and
 * never reaches the bundle.
 */
export const sentryDsn = (): string | undefined => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return dsn && dsn.length > 0 ? dsn : undefined;
};

/**
 * Error reporting is off unless a DSN is configured. That is what keeps this
 * inert in CI, in local development and in any deployment that has not been
 * given a DSN — the gate runs `npm run build` with no Sentry configuration at
 * all, and must keep passing.
 */
export const errorReportingEnabled = (): boolean => sentryDsn() !== undefined;

const environment = (): string =>
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Tracing is OFF by default. It is a performance feature, it is billed by
 * volume, and its spans carry request URLs — which in this app contain job,
 * quote and invoice ids. Turn it on deliberately by setting a rate, rather
 * than inheriting one.
 */
const tracesSampleRate = (): number => {
  const raw = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
};

export type SentryInitOptions = {
  dsn: string | undefined;
  enabled: boolean;
  environment: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  beforeSend: <T extends object>(event: T) => T | null;
};

/**
 * Shared options for every runtime.
 *
 * `sendDefaultPii: false` is the single most important line here. With it on,
 * Sentry attaches request headers, cookies and the client IP to every event —
 * for this app that means a contractor's session cookie and a customer's IP
 * on any error raised while viewing a quote. It is off, and the scrubber
 * removes those keys again in case a future integration re-adds them.
 *
 * Session Replay is deliberately NOT configured. It records the DOM, and the
 * DOM on a job page is the customer's name, site address and phone number.
 * There is no sampling rate at which that is acceptable here.
 */
export const baseSentryOptions = (): SentryInitOptions => ({
  dsn: sentryDsn(),
  enabled: errorReportingEnabled(),
  environment: environment(),
  sendDefaultPii: false,
  tracesSampleRate: tracesSampleRate(),
  beforeSend: scrubEvent,
});
