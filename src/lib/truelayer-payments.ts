// TrueLayer Payments — create a pay-by-bank payment and verify status webhooks.
//
// Settlement model (confirmed with the TrueLayer agreement): the pay-in settles
// DIRECTLY into the trade's own bank account as an external beneficiary over
// Faster Payments. There is no motko merchant account and no payout step —
// motko never holds the funds. The motko fee is accrued separately at the
// payment_executed webhook and collected later (see motko-fee.ts).
//
// Networked module — must NOT be imported by any pure/deterministic helper.

import { randomUUID } from "node:crypto";
import { extractJku, sign, verify, type HttpMethod } from "truelayer-signing";
import {
  getTrueLayerConfig,
  getTrueLayerSigning,
  type TrueLayerConfig,
} from "@/lib/truelayer";

// Request path for the create-payment endpoint. This single constant feeds BOTH
// the fetch URL and the `Tl-Signature` signed path, so the signature can never
// drift from the request it signs — if TrueLayer ever moves the path, fix it
// here in one place. `method` defaults to POST inside the signing lib, so we
// never import the `HttpMethod` const enum as a value (isolatedModules-safe).
const CREATE_PAYMENT_PATH = "/v3/payments";

// TrueLayer's webhook signatures carry a `jku` pointing at the JWKS to verify
// against. We only trust these hosts to prevent SSRF via a forged jku.
const WEBHOOK_JWKS_HOSTS = new Set([
  "webhooks.truelayer.com",
  "webhooks.truelayer-sandbox.com",
]);

// client_credentials tokens are short-lived; cache in-process and refresh a
// little early so a request never races the expiry.
type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

const getAccessToken = async (config: TrueLayerConfig): Promise<string> => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  const res = await fetch(`${config.authBaseUrl}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "payments",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `TrueLayer token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
};

// The trade's own account that receives the customer's payment in full.
export type TrueLayerBeneficiary = {
  accountHolderName: string;
  // 6 digits, no separators.
  sortCode: string;
  // 8 digits.
  accountNumber: string;
  // Statement reference the customer's bank shows against the transfer.
  reference: string;
};

export type CreatePaymentParams = {
  amountInMinor: number;
  beneficiary: TrueLayerBeneficiary;
  // The payer (customer). Only `name` is required by our flow.
  payer: { id?: string; name: string; email?: string; phone?: string };
  // Echoed back verbatim on every webhook — we stash invoice_id/job_id here so
  // the webhook can map the payment to our records without a lookup column.
  // TrueLayer limits: <=10 pairs, key <=40 chars, value <=500 chars.
  metadata?: Record<string, string>;
  // Supply to make retries idempotent; a fresh UUID is used otherwise.
  idempotencyKey?: string;
};

export type TrueLayerPayment = {
  id: string;
  // Consumed by the hosted payment page / embedded SDK to send the payer to
  // their bank. Never store this beyond the single pay session.
  resourceToken: string;
  status: string;
};

export const createTrueLayerPayment = async (
  params: CreatePaymentParams,
): Promise<TrueLayerPayment> => {
  const config = getTrueLayerConfig();
  const signing = getTrueLayerSigning();
  if (!config || !signing) {
    throw new Error("TrueLayer is not configured");
  }

  const token = await getAccessToken(config);
  const idempotencyKey = params.idempotencyKey ?? randomUUID();

  // Build the payer object without undefined keys (exactOptionalPropertyTypes).
  const user: Record<string, string> = { name: params.payer.name };
  if (params.payer.id) user.id = params.payer.id;
  if (params.payer.email) user.email = params.payer.email;
  if (params.payer.phone) user.phone = params.payer.phone;

  const body = JSON.stringify({
    amount_in_minor: params.amountInMinor,
    currency: "GBP",
    payment_method: {
      type: "bank_transfer",
      provider_selection: { type: "user_selected" },
      beneficiary: {
        type: "external_account",
        account_holder_name: params.beneficiary.accountHolderName,
        reference: params.beneficiary.reference,
        account_identifier: {
          type: "sort_code_account_number",
          sort_code: params.beneficiary.sortCode,
          account_number: params.beneficiary.accountNumber,
        },
      },
    },
    user,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });

  // The signed path MUST equal the request path; both come from the same const.
  const tlSignature = sign({
    kid: signing.kid,
    privateKeyPem: signing.privateKeyPem,
    path: CREATE_PAYMENT_PATH,
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });

  const res = await fetch(`${config.apiBaseUrl}${CREATE_PAYMENT_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "Tl-Signature": tlSignature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `TrueLayer create payment failed: ${res.status} ${await res.text()}`,
    );
  }

  const json = (await res.json()) as {
    id: string;
    resource_token: string;
    status: string;
  };
  return {
    id: json.id,
    resourceToken: json.resource_token,
    status: json.status,
  };
};

// Reads a payment's current status. This is a read-only GET, so — unlike
// create — it needs NO Tl-Signature and no Idempotency-Key, only a bearer token.
// Used by the reconcile job / expiry re-check, never as the source of truth for
// crediting (that's the signature-verified payment_executed webhook).
export const getTrueLayerPaymentStatus = async (
  paymentId: string,
): Promise<{ id: string; status: string } | null> => {
  const config = getTrueLayerConfig();
  if (!config) return null;
  const token = await getAccessToken(config);
  const res = await fetch(
    `${config.apiBaseUrl}${CREATE_PAYMENT_PATH}/${encodeURIComponent(paymentId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { id: string; status: string };
  return { id: json.id, status: json.status };
};

// Verifies an inbound TrueLayer status webhook against TrueLayer's published
// JWKS (fetched from the signature's own jku, host-allowlisted). Returns true
// only when the signature covers the exact body and path we received. Callers
// MUST reject the webhook when this returns false.
export const verifyTrueLayerWebhook = async (params: {
  signature: string;
  // The path TrueLayer POSTed to (our webhook route path).
  path: string;
  body: string;
  headers?: Record<string, string>;
}): Promise<boolean> => {
  let jku: string | undefined;
  try {
    jku = extractJku(params.signature);
  } catch {
    return false;
  }
  if (!jku) return false;

  let jkuUrl: URL;
  try {
    jkuUrl = new URL(jku);
  } catch {
    return false;
  }
  if (jkuUrl.protocol !== "https:" || !WEBHOOK_JWKS_HOSTS.has(jkuUrl.hostname)) {
    return false;
  }

  const jwksRes = await fetch(jkuUrl);
  if (!jwksRes.ok) return false;
  const jwks = await jwksRes.text();

  try {
    verify({
      jwks,
      signature: params.signature,
      // Webhooks are always delivered as POST; cast keeps us off the const enum.
      method: "POST" as HttpMethod,
      path: params.path,
      body: params.body,
      ...(params.headers ? { headers: params.headers } : {}),
    });
    return true;
  } catch {
    return false;
  }
};
