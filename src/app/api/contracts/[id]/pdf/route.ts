import { NextResponse, type NextRequest } from "next/server";
import { renderContractPdf } from "@/lib/pdf/render-contract";
import { checkRateLimits, getRateLimitConfig } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  // Rate limiting: per-IP and per-resource (logical AND)
  const clientIp = getClientIp(request);
  const isServiceCaller = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const checks = [];

  const ipConfig = getRateLimitConfig("RATE_LIMIT_PDF_PER_IP", "RATE_LIMIT_PDF_WINDOW_IP");
  if (ipConfig && clientIp) {
    checks.push({ key: `pdf:ip:${clientIp}`, config: ipConfig });
  }

  const resourceConfig = getRateLimitConfig("RATE_LIMIT_PDF_PER_RESOURCE", "RATE_LIMIT_PDF_WINDOW_RESOURCE");
  if (resourceConfig) {
    checks.push({ key: `pdf:resource:${id}`, config: resourceConfig });
  }

  if (checks.length > 0) {
    const limitResult = await checkRateLimits(checks, { skipAuth: isServiceCaller });
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

  const buffer = await renderContractPdf(id);

  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contract-${id}.pdf"`,
    },
  });
};
