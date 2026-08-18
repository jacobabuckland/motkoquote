import { NextResponse, type NextRequest } from "next/server";
import { createRealtimeClientSecret } from "@/lib/realtime";
import { buildJobIntakeInstructions, BASE_REALTIME_TOOLS } from "@/lib/voice/job-intake-prompt";
import { checkRateLimit, clientIpKey, recordRateLimitUse } from "@/lib/rate-limit";

// Mints a short-lived OpenAI Realtime token for a guest job intake — someone
// using the app before they have an account.
//
// This route reads no table and writes no table. It is deliberately the ONLY
// unauthenticated server call the guest voice path makes on our side (the two
// Anthropic calls that draft the quote are the other two round trips, and they
// touch no database either). There is no job id to return because a guest quote
// is a rendered artefact, never a job aggregate.
//
// It does spend OpenAI credit per call, so it is rate limited per caller and
// FAILS CLOSED: a limiter that cannot answer denies the request.

const GUEST_SESSION_LIMIT = 5;
const GUEST_SESSION_WINDOW_MS = 60 * 60 * 1000;

export const POST = async (request: NextRequest) => {
  const limitKey = `guest-realtime:${clientIpKey(request.headers)}`;
  const limitOptions = {
    limit: GUEST_SESSION_LIMIT,
    windowMs: GUEST_SESSION_WINDOW_MS,
  };

  // The gate runs BEFORE the mint; the allowance is spent AFTER it succeeds.
  // What costs money is a granted token, not a request for one — so a caller
  // is never charged for an upstream outage they didn't cause.
  const decision = checkRateLimit(limitKey, limitOptions);

  if (!decision.allowed) {
    // Neither message offers an account as the remedy. Voice is the free path;
    // suggesting signing up to get past a rate limit reads as a paywall on it
    // and re-opens the very guideline this flow exists to answer.
    const overLimit = decision.reason === "over_limit";
    return NextResponse.json(
      {
        error: overLimit
          ? "Too many voice sessions just now. Give it a few minutes and try again."
          : "Voice is temporarily unavailable. Try again in a moment.",
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
    // No personalisation: a guest has no trade, no name and no past-job
    // context. Those are omitted, never stubbed or defaulted — the base prompt
    // still carries the must-ask pricing slots (crew, pricing mode, materials),
    // which is the one thing that may not differ from the signed-in intake.
    const clientSecret = await createRealtimeClientSecret({
      instructions: buildJobIntakeInstructions(),
      tools: BASE_REALTIME_TOOLS,
    });

    // Credit has now actually been spent — charge the allowance for it.
    recordRateLimitUse(limitKey, limitOptions);

    return NextResponse.json({ clientSecret });
  } catch {
    return NextResponse.json(
      { error: "Couldn't start the voice session. Try again in a moment." },
      { status: 502 },
    );
  }
};
