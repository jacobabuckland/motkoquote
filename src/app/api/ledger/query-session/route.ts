import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRealtimeClientSecret } from "@/lib/realtime";
import {
  buildLedgerQueryInstructions,
  LEDGER_QUERY_TOOLS,
} from "@/lib/voice/ledger-query-prompt";
import { checkRateLimit, recordRateLimitUse } from "@/lib/rate-limit";
import { AsyncLocalStorage } from "node:async_hooks";

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

// Request context storage for test mocking
export const requestContext = new AsyncLocalStorage<Request>();

const handleRequest = async (request: Request) => {
  // Authentication: check for authenticated user via Supabase
  let supabase;
  let user;

  try {
    supabase = await createClient();
    const userData = await supabase.auth.getUser();
    user = userData.data.user;
  } catch {
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

  const contractorId = contractor.id;

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
    const clientSecret = await createRealtimeClientSecret({
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

export const POST = async (request: Request) => {
  // Store request in AsyncLocalStorage for test mocking
  return requestContext.run(request, () => handleRequest(request));
};
