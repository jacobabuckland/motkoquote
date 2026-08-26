import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// The User-Agent tag Capacitor appends inside the WKWebView
// (`appendUserAgent` in capacitor.config.ts) so the server can tell the native
// shell apart from a browser. Duplicated from the root route rather than
// imported, because that route is frozen behind an accepted App Store
// submission; tests/regression/back-to-app-target.test.ts binds the two copies
// together so they cannot drift.
export const NATIVE_SHELL_UA_TAG = "MotkoApp";

// Where a back control on a PUBLIC page should land — a page reachable both
// from the open web and from inside the native shell, where "back" must return
// the reader into the app rather than into a sales page.
//
// This mirrors, deliberately, the three-way branch the root route already
// performs server-side: a signed-in visitor goes to the dashboard, the native
// shell goes to guest voice capture, and everyone else gets the marketing
// landing page. Resolving it here rather than pointing back at "/" and letting
// the redirect happen is what makes the destination survive the planned root →
// motko.co.uk redirect: once that lands, a back button pointing at "/" would
// eject a signed-in contractor onto an external domain mid-session.
export const resolveAppHomeHref = async (): Promise<string> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return "/dashboard";

  const userAgent = (await headers()).get("user-agent") ?? "";
  if (userAgent.includes(NATIVE_SHELL_UA_TAG)) return "/start";

  return "/";
};
