import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// motko.app is the product. The marketing copy that used to render here now
// lives at motko.co.uk and is the original there — serving it on both domains
// was always the temporary half of that move, and this is the other half.
//
// So the root renders nothing. It decides which of three places the visitor
// actually meant and sends them, and every branch below is a redirect.
//
// The (marketing) route group survives the marketing page it was named for,
// and has to. Two frozen acceptance tests read this layout: #200 requires that
// a PUBLIC route holds no loading.tsx of its own and knows "(marketing)" as
// the name of the public root, while #269 requires src/app/loading.tsx to
// exist and rotate. Moving this file up to src/app/ puts the root and that
// loading.tsx in the same directory and makes the two contradict each other.
// The group keeps them apart. Renaming it breaks #200's prefix list.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Logged-in visitors don't want a sales page — send them to the app.
  if (user) redirect("/dashboard");

  // The native app is a sales channel of one: whoever opens it already chose
  // Motko. Skip the marketing site entirely and drop them straight into voice
  // capture — no account, no sign-in wall. Quoting by voice is not an
  // account-based feature and must not be gated behind registration; Sign In
  // sits in that screen's top bar for anyone who already has an account.
  //
  // This is the path that passed 5.1.1(v) review and it is unchanged.
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (userAgent.includes("MotkoApp")) redirect("/start");

  // Everyone else arriving on the web: this domain is the app, not the
  // shopfront. /login carries the link to sign up, so one destination serves
  // both — and it is /login rather than /signup deliberately, because someone
  // typing the bare domain is far more often a returning trade than a new one.
  redirect("/login");
}
