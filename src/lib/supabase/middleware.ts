import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public API routes — anything not listed here requires authentication.
// Dynamic segments supported: /api/quotes/[id]/pdf matches /api/quotes/abc123/pdf
const PUBLIC_API_ROUTES = [
  "/api/quotes/[id]/pdf",
  "/api/contracts/[id]/pdf",
  "/api/truelayer/create-payment",
  "/api/truelayer/webhook",
  "/api/stripe/webhook",
  "/api/twilio/inbound",
  "/api/cron/chase",
  "/api/cron/collect-fees",
  "/api/cron/purge-accounts",
  "/api/cron/reconcile-free-jobs",
  "/api/cron/retry-fee-collections",
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/privacy") ||
    request.nextUrl.pathname.startsWith("/support") ||
    request.nextUrl.pathname.startsWith("/q/") ||
    request.nextUrl.pathname.startsWith("/i/") ||
    request.nextUrl.pathname.startsWith("/c/") ||
    isPublicApiRoute(request.nextUrl.pathname);

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
};
