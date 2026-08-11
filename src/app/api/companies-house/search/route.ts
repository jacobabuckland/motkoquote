import { NextResponse, type NextRequest } from "next/server";
import { searchCompanies } from "@/lib/companies-house";
import { checkRateLimits, getRateLimitConfig } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

export const GET = async (request: NextRequest) => {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  // Rate limiting: per-IP only
  const clientIp = getClientIp(request);
  const isServiceCaller = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const ipConfig = getRateLimitConfig("RATE_LIMIT_COMPANIES_HOUSE_PER_IP", "RATE_LIMIT_COMPANIES_HOUSE_WINDOW");

  if (ipConfig && clientIp) {
    const limitResult = await checkRateLimits([{ key: `companies-house:ip:${clientIp}`, config: ipConfig }], { skipAuth: isServiceCaller });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${limitResult.retryAfter} seconds.` },
        {
          status: 429,
          headers: { "Retry-After": limitResult.retryAfter.toString() }
        }
      );
    }
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
