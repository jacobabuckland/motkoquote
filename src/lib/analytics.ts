import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeout, TIMEOUT_MS } from "@/lib/with-timeout";

type Properties = Record<string, unknown>;

/**
 * Fire-and-forget product analytics. Never throws — a failed insert must never
 * block or break the flow that emitted the event; errors are swallowed with a
 * console.warn.
 *
 * Server-side helper. The current auth user is resolved from the request
 * cookies and the row is written as that user (RLS: authenticated users may
 * insert only their own rows). Anonymous contexts — e.g. a customer opening a
 * public quote link — have no session; pass `{ allowAnonymous: true }` to write
 * a `user_id = null` row via the service role, which RLS would otherwise forbid
 * for anon. Without that flag, an anonymous call is a no-op (so this helper
 * can't be abused to write null-user events from arbitrary places).
 */
export const track = async (
  eventName: string,
  properties: Properties = {},
  options: { allowAnonymous?: boolean } = {},
): Promise<void> => {
  try {
    // Bound the whole write. A rejected insert is already handled by the catch,
    // but a network call that simply *hangs* (never resolves, never rejects)
    // would slip past try/catch and wedge the caller — which is how a post-flip
    // `await track(...)` in a server action leaves the client stuck on
    // "Sending…". withTimeout guarantees this returns even then.
    await withTimeout(
      (async () => {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          await supabase
            .from("events")
            .insert({ user_id: user.id, event_name: eventName, properties });
        } else if (options.allowAnonymous) {
          await createAdminClient()
            .from("events")
            .insert({ user_id: null, event_name: eventName, properties });
        }
      })(),
      TIMEOUT_MS.analytics,
      `track(${eventName})`,
    );
  } catch (error) {
    console.warn(`[analytics] failed to track "${eventName}"`, error);
  }
};

/**
 * Records an application error. Writes to the console (so it surfaces in server
 * logs) and, best-effort, to the events table as an `error` event tagged with
 * its origin, so error rates are visible alongside product events. Never throws.
 */
export const logError = async (
  source: "server" | "client",
  message: string,
  context: Properties = {},
): Promise<void> => {
  console.error(`[${source}] ${message}`, context);
  await track("error", { source, message, ...context });
};
