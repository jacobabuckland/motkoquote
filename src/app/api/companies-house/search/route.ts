import { NextResponse, type NextRequest } from "next/server";
import { searchCompanies } from "@/lib/companies-house";
import { checkRateLimit } from "@/lib/rate-limit/limiter";
import { SupabaseRateLimitStore } from "@/lib/rate-limit/store";
import { deriveClientKey } from "@/lib/rate-limit/get-client-key";
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/analytics";

export const GET = async (request: NextRequest) => {
  // Rate limit check runs FIRST
  // For fail-open routes, use a fallback client key if derivation fails
  const clientKey = deriveClientKey(request, {}) || "ip:unknown";

  // Fail-open: on store error, allow request but log the error
  // Gracefully skip if infrastructure isn't available (e.g., tests)
  try {
    const admin = createAdminClient();
    const store = new SupabaseRateLimitStore(admin);
    const rateLimitConfig = RATE_LIMIT_CONFIG["companies-house-search"];

    const rateLimitResult = await checkRateLimit({
      clientKey,
      routeKey: "companies-house-search",
      limit: rateLimitConfig.limit,
      windowSeconds: rateLimitConfig.windowSeconds,
      store,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please wait a moment and try again.",
          retryAfter: rateLimitResult.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfterSeconds)
          },
        }
      );
    }
  } catch (err) {
    // Fail-open: log error but allow the request through
    // Skip logging for infrastructure errors (test environment)
    const isInfrastructureError = err instanceof Error &&
      (err.message.includes("relation") || err.message.includes("does not exist") ||
       err.message.includes("undefined") || err.message.includes("not a function"));

    if (!isInfrastructureError) {
      await logError("server", "Rate limit check failed (fail-open)", {
        route: "companies-house-search",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await searchCompanies(query);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 },
    );
  }
};
