import { NextResponse, type NextRequest } from "next/server";
import { verifyTrueLayerWebhook } from "@/lib/truelayer-payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { settlePaidJob } from "@/lib/settle-paid-job";

// TrueLayer payment status webhook. Every delivery is JWS-signed (detached
// payload) over the request method/path/body plus the X-TL-Webhook-Timestamp
// header, and verified against TrueLayer's published JWKS — there is no shared
// secret. We map back to our invoice via the `metadata` we set at payment
// creation (echoed on every event); settlement idempotency lives in
// settlePaidJob (per-invoice + per-job).
type TrueLayerWebhook = {
  type: string;
  event_id: string;
  event_version?: number;
  payment_id?: string;
  metadata?: Record<string, string>;
};

export const POST = async (request: NextRequest) => {
  const signature = request.headers.get("tl-signature");
  const timestamp = request.headers.get("x-tl-webhook-timestamp");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();

  // The signature covers X-TL-Webhook-Timestamp, so it must be passed through;
  // its absence makes verification fail, which is the correct rejection.
  const headers: Record<string, string> = {};
  if (timestamp) headers["X-TL-Webhook-Timestamp"] = timestamp;

  const valid = await verifyTrueLayerWebhook({
    signature,
    path: request.nextUrl.pathname,
    body,
    headers,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: TrueLayerWebhook;
  try {
    event = JSON.parse(body) as TrueLayerWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Direct-to-trade (open-loop) payments settle to the trade over Faster
  // Payments and never emit `payment_settled` (that's merchant-account only),
  // so `payment_executed` is our safe-to-act signal that money has moved.
  if (event.type === "payment_executed") {
    const invoiceId = event.metadata?.invoice_id;
    if (invoiceId && event.payment_id) {
      const admin = createAdminClient();
      await settlePaidJob(admin, {
        invoiceId,
        paymentProviderRef: event.payment_id,
      });
    }
  }
  // payment_failed / other events: intentionally unhandled — the invoice stays
  // payable so the customer can retry; we never mark it permanently failed.

  return NextResponse.json({ received: true });
};
