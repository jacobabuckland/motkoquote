import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public API routes — anything not listed here requires authentication.
// Dynamic segments supported: /api/quotes/[id]/pdf matches /api/quotes/abc123/pdf
//
// Exported so the no-blank-link invariant can bind against it: an app link
// opened with target="_blank" leaves the Capacitor WKWebView for the system
// browser, which has no session cookie, so pointing one at a route that is NOT
// in this list sends a signed-in contractor to /login. See
// tests/acceptance/blank-target-public-routes.test.ts.
export const PUBLIC_API_ROUTES = [
  // Mints an OpenAI Realtime token for a guest job intake. Reads no table and
  // writes no table; rate limited per caller and fails closed (see the route).
  "/api/guest/realtime-session",
  "/api/quotes/[id]/pdf",
  "/api/contracts/[id]/pdf",
  // Polled by the customer's payment-return page, which is itself public and
  // reached by a bare invoice id. Returns state/amount/paidAt and nothing
  // else — no PII, no bank details, no Stripe ids — and writes nothing.
  "/api/invoices/[id]/payment-status",
  // Fetched by the invoice page only after a payment attempt has failed, so a
  // customer whose bank the rail cannot serve still has a route to paying.
  // Public for the same reason the pay page is: reached by a bare invoice id,
  // by someone with no account. Returns the payee account only, and 404s once
  // the invoice is paid.
  "/api/invoices/[id]/transfer-details",
  "/api/stripe/create-payment-intent",
  "/api/stripe/webhook",
  "/api/twilio/inbound",
  "/api/cron/chase",
  "/api/cron/purge-accounts",
  "/api/cron/reconcile-free-jobs",
  "/api/cron/report-off-rails-invoices",
] as const;

// Helper to match a pathname against a pattern with dynamic segments.
// Converts Next.js dynamic segment patterns ([id]) to regex equivalents.
const matchesPattern = (pathname: string, pattern: string): boolean => {
  // Convert Next.js dynamic segment pattern to regex
  // [id] -> [^\/]+ (one or more non-slash characters)
  const regexPattern = pattern
    .replace(/\[([^\]]+)\]/g, "[^\\/]+")
    .replace(/\//g, "\\/"); // Escape forward slashes

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(pathname);
};

// Check if pathname is in the public API routes list
const isPublicApiRoute = (pathname: string): boolean => {
  return PUBLIC_API_ROUTES.some((pattern) => matchesPattern(pathname, pattern));
};

export const updateSession = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Support both cookie-based auth and Authorization header (for health checks)
  const authHeader = request.headers?.get?.("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;

  const {
    data: { user },
  } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();

  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/join/") ||
    // The guest quote flow: voice capture, drafting and PDF preview with no
    // account. Nothing under /start creates, references or projects over a row.
    request.nextUrl.pathname.startsWith("/start") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/privacy") ||
    request.nextUrl.pathname.startsWith("/support") ||
    request.nextUrl.pathname.startsWith("/q/") ||
    request.nextUrl.pathname.startsWith("/i/") ||
    request.nextUrl.pathname.startsWith("/c/") ||
    // Platform association metadata, fetched by Apple's and Google's crawlers
    // over plain unauthenticated HTTPS. Apple requires the AASA file be served
    // at exactly /.well-known/apple-app-site-association with NO redirect, and
    // its fetcher carries no session — so falling through to the /login
    // redirect below meant the domain association was never established and
    // NO universal link worked, on any path. That silently included
    // /i/*/paid, the Stripe return the app is supposed to own.
    //
    // Registered here rather than excluded in the proxy matcher deliberately:
    // this is a public surface and it belongs in the list where public
    // exposure is reviewed, not hidden behind a regex that reads as a
    // performance exclusion. These files read no table and carry no PII.
    request.nextUrl.pathname.startsWith("/.well-known/") ||
    isPublicApiRoute(request.nextUrl.pathname);

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
};
