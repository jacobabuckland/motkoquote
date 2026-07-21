import { NextResponse, type NextRequest } from "next/server";
import { verifyTrueLayerWebhook } from "@/lib/truelayer-payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { settlePaidJob } from "@/lib/settle-paid-job";
import { settleFeeCollection, failFeeCollection } from "@/lib/collect-fees";

// TrueLayer payment status webhook. Every delivery is JWS-signed (detached
// payload) over the request method/path/body plus the X-TL-Webhook-Timestamp
// header, and verified against TrueLayer's published JWKS — there is no shared
// secret. We map back to our records via the `metadata` we set at payment
// creation (echoed on every event): `invoice_id` for a customer pay-in,
// `fee_collection_id` for a motko fee charge against a mandate. Settlement
// idempotency lives downstream (settlePaidJob / settleFeeCollection).
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

  const feeCollectionId = event.metadata?.fee_collection_id;
  const invoiceId = event.metadata?.invoice_id;

  // Direct-to-trade (open-loop) payments settle to the trade over Faster
  // Payments and never emit `payment_settled` (that's merchant-account only),
  // so `payment_executed` is our safe-to-act signal that money has moved.
  if (event.type === "payment_executed") {
    const admin = createAdminClient();
    if (feeCollectionId) {
      // A motko fee charge cleared — mark the collection collected, flip its
      // jobs to 'collected', return the trade to 'active' billing.
      await settleFeeCollection(admin, {
        feeCollectionId,
        providerRef: event.payment_id ?? feeCollectionId,
        now: new Date().toISOString(),
      });
    } else if (invoiceId && event.payment_id) {
      await settlePaidJob(admin, {
        invoiceId,
        paymentProviderRef: event.payment_id,
      });
    }
  } else if (event.type === "payment_failed" && feeCollectionId) {
    // A fee charge failed asynchronously — enter dunning. (A failed customer
    // pay-in is deliberately ignored below so the invoice stays payable.)
    const admin = createAdminClient();
    await failFeeCollection(admin, { feeCollectionId, reason: "payment_failed" });
  }
  // payment_failed on a customer pay-in / other events: intentionally unhandled
  // — the invoice stays payable so the customer can retry.

  return NextResponse.json({ received: true });
};
