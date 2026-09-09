import { NextResponse, type NextRequest } from "next/server";
import { searchCompanies } from "@/lib/companies-house";
import { logError } from "@/lib/analytics";

// A Companies House failure leaves a record, rather than only a line of text on
// the setup screen.
//
// This route caught its error, returned the message in a 502 body, and told
// nobody. Sentry only captures what reaches `onRequestError` (see
// src/instrumentation.ts) and a caught error never does, so the integration
// could fail in production and the sole trace was whatever the contractor
// happened to read in front of them. It did fail: the key returned 401 for long
// enough to reach a remediation plan, and there was not one Companies House
// event in Sentry across 90 days to diagnose it from.
//
// This is NOT the signal that changes behaviour — `chError` on the setup form
// already tells the contractor the lookup failed, and they can type the number
// by hand. This is the evidence behind it, the same split the push diagnostics
// route records for itself.
//
// The key is never logged, and nothing here carries customer PII: a Companies
// House query is a business name, typically the contractor's own.

export const GET = async (request: NextRequest) => {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await searchCompanies(query);
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    // Awaited, not fire-and-forget: on a serverless function the response ends
    // the invocation, and a floating promise can be frozen before it writes.
    await logError("server", "Companies House search failed", { reason: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
};
