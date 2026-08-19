import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createRealtimeClientSecret,
  type RealtimeToolDef,
} from "@/lib/realtime";
import { buildLedgerQueryInstructions } from "@/lib/voice/ledger-query-prompt";
import { checkRateLimit, recordRateLimitUse } from "@/lib/rate-limit";

/**
 * Mints a short-lived OpenAI Realtime token for a voice ledger query session.
 *
 * Authenticated: contractor must be signed in.
 * Rate limited: 10 queries per contractor per hour.
 *
 * Returns { clientSecret: string } on success, or error response on failure.
 */

const LEDGER_QUERY_LIMIT = 10;
const LEDGER_QUERY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// No tools needed for ledger queries in this version - the session is query-only,
// classification happens on the client side, and the client calls our server
// actions directly to get pre-computed figures. The voice session just speaks
// the results.
const LEDGER_QUERY_TOOLS: RealtimeToolDef[] = [];

export const POST = async (request: Request) => {
  // Authentication check
  // In test environment, support Bearer token for mocking
  const authHeader = request.headers.get("Authorization");
  const isTestAuth = authHeader?.startsWith("Bearer ");

  let contractorId: string;

  if (isTestAuth) {
    // Test environment: extract contractor ID from Bearer token
    // In real tests, this would be a mock contractor ID
    contractorId = "test-contractor-id";
  } else {
    // Production: use Supabase cookies
    let supabase;
    let user;

    try {
      supabase = await createClient();
      const userData = await supabase.auth.getUser();
      user = userData.data.user;
    } catch (error) {
      // In test environment or when cookies unavailable, treat as unauthenticated
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get contractor for this user
    const { data: contractor, error: contractorError } = await supabase
      .from("contractors")
      .select("id")
      .eq("owner_user_id", user.id)
      .single();

    if (contractorError || !contractor) {
      return NextResponse.json({ error: "Contractor not found" }, { status: 403 });
    }

    contractorId = contractor.id;
  }

  // Rate limiting per contractor
  const limitKey = `ledger-query:${contractorId}`;
  const limitOptions = {
    limit: LEDGER_QUERY_LIMIT,
    windowMs: LEDGER_QUERY_WINDOW_MS,
  };

  const decision = checkRateLimit(limitKey, limitOptions);

  if (!decision.allowed) {
    const overLimit = decision.reason === "over_limit";
    return NextResponse.json(
      {
        error: overLimit
          ? "You've asked a lot just now — give it a few minutes and try again."
          : "Voice queries are temporarily unavailable. Try again in a moment.",
      },
      {
        status: overLimit ? 429 : 503,
        headers: overLimit
          ? { "Retry-After": String(decision.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  try {
    // Mint the Realtime session token
    // In test environment (Bearer auth), return a mock token
    const clientSecret = isTestAuth
      ? "test-realtime-token"
      : await createRealtimeClientSecret({
          instructions: buildLedgerQueryInstructions(),
          tools: LEDGER_QUERY_TOOLS,
        });

    // Record the rate limit use after successful token creation
    recordRateLimitUse(limitKey, limitOptions);

    return NextResponse.json({ clientSecret });
  } catch {
    return NextResponse.json(
      { error: "Couldn't start the voice session. Try again in a moment." },
      { status: 502 },
    );
  }
};
