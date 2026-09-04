import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { redactContactDetails } from "@/lib/voice/contact-detail-guard";

/**
 * Strip customer data out of a Sentry event before it leaves the process.
 *
 * OBS-5's criterion is that no customer name, address, phone number, email or
 * payment detail reaches Sentry. This repository makes that harder than usual:
 * `jobs.transcript`, `conversation_json` and `sow_json` all carry a customer's
 * name, site address, phone and email exactly as captured during intake, and a
 * server error anywhere near the quote path can pull them into a request body,
 * a breadcrumb or an exception's extra data.
 *
 * TWO LAYERS, AND THE ORDER MATTERS.
 *
 * The first is structural: remove the CARRIERS. Request bodies, cookies, all
 * but a short list of headers, and the payloads of console and network
 * breadcrumbs are deleted outright, because those are the fields customer data
 * actually travels in. This is the layer that does the work.
 *
 * The second is `redactContactDetails`, already written and tested for PFIX-9,
 * applied over whatever string content survives. It is a backstop, not the
 * defence — it matches phones, emails and postcodes BY SHAPE.
 *
 * WHY THE ORDER MATTERS: no pattern reliably matches a customer's NAME or a
 * street address. "Dave" and "14 Elm Road" are ordinary words. Relying on
 * redaction alone would look thorough and would leak the two fields hardest to
 * explain away. Deleting the carriers is what actually holds.
 *
 * THE LIMIT, STATED RATHER THAN GLOSSED: a name inside an exception MESSAGE —
 * `Error: no customer named Dave Smith` — still reaches Sentry. Structural
 * removal cannot see it, and pattern redaction cannot match it. The criterion
 * is met for every field the application puts into a payload; it is not an
 * absolute guarantee about arbitrary error text, and claiming otherwise would
 * be worse than saying so here.
 */

// Headers worth keeping for debugging and free of customer data. Everything
// else goes: cookies carry sessions, and referer/origin can carry ids we have
// no reason to ship.
const KEPT_HEADERS = new Set(["content-type", "user-agent", "accept-language"]);

/** Breadcrumb categories whose payloads can carry quote or customer content. */
const STRIPPED_BREADCRUMB_CATEGORIES = new Set([
  "console",
  "fetch",
  "xhr",
  "navigation",
]);

const scrubString = (value: string): string => redactContactDetails(value);

/**
 * Walk a value, redacting strings, to a bounded depth.
 *
 * Bounded because a Sentry event is not guaranteed acyclic and an unbounded
 * walk on the error path is a second outage rather than a diagnostic. Anything
 * deeper than this is dropped rather than sent unexamined — an event missing a
 * field is recoverable, an event carrying a site address is not.
 */
const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[depth limit]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
};

/**
 * The `beforeSend` hook. Exported separately from the Sentry init calls so it
 * can be tested directly — the init files run for their side effects and are
 * awkward to exercise, and this is the part that must be right.
 */
/**
 * The run identifier for a crash, taken from the URL.
 *
 * `run_id` IS the job id — deliberately, per the comment at
 * `src/app/jobs/actions.ts:167`, rather than a second identifier to reconcile.
 * So any event raised on a job page already carries it in the path, and no
 * component has to mount and set a tag for this to work: it applies to server
 * and client events alike, including a crash that takes the page down before
 * any boundary runs, which is the class OBS-2 cannot see and this exists for.
 */
export const runIdFromUrl = (url: string | undefined): string | undefined =>
  url?.match(/\/jobs\/([0-9a-fA-F-]{36})\b/)?.[1];

export const scrubEvent = (event: ErrorEvent, _hint?: EventHint): ErrorEvent => {
  // Read the run id BEFORE anything redacts the URL. A UUID is not customer
  // data and `redactContactDetails` is not meant to match one, but it matches
  // long digit runs by shape, and an all-numeric UUID segment is possible.
  // Taking the id first means a coincidence cannot cost us the tag.
  const runId = runIdFromUrl(event.request?.url);
  if (runId) event.tags = { ...event.tags, run_id: runId };

  // The user object: Sentry attaches ip_address and, where configured, email.
  // A contractor id is useful and is not customer data; nothing else is kept.
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }

  if (event.request) {
    // The request body is the single largest exposure: a server action failing
    // mid-quote has the whole SoW in it.
    delete event.request.data;
    delete event.request.cookies;

    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(event.request.headers)) {
        if (KEPT_HEADERS.has(name.toLowerCase())) headers[name] = value;
      }
      event.request.headers = headers;
    }

    // Query strings carry ids, which are fine, but can also carry a `?ref=` or
    // a copied email. Redact rather than drop — the path itself is diagnostic.
    if (event.request.query_string && typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
    if (event.request.url) event.request.url = scrubString(event.request.url);
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => {
      const category = crumb.category ?? "";
      if (STRIPPED_BREADCRUMB_CATEGORIES.has(category)) {
        // Keep that it happened and when; drop what it carried.
        return { ...crumb, data: undefined, message: crumb.message ? scrubString(crumb.message) : undefined };
      }
      return {
        ...crumb,
        message: crumb.message ? scrubString(crumb.message) : undefined,
        data: crumb.data ? (scrubDeep(crumb.data) as Record<string, unknown>) : undefined,
      };
    });
  }

  if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    event.contexts = scrubDeep(event.contexts) as NonNullable<ErrorEvent["contexts"]>;
  }

  // Exception messages and values are the residual case described above. They
  // are redacted for the shapes we can match, which is better than nothing and
  // is not claimed to be complete.
  if (event.message) event.message = scrubString(event.message);
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value) => ({
      ...value,
      value: value.value ? scrubString(value.value) : value.value,
    }));
  }

  return event;
};
