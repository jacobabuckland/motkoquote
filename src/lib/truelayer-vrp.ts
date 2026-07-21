// TrueLayer commercial VRP (cVRP) — set up a fee-collection mandate and charge
// accrued motko fees against it.
//
// Model: the trade authorises ONE commercial VRP mandate (buildMandateHostedPageUrl)
// that lets motko pull its accrued fees each month straight from the trade's
// bank into motko's merchant account. Subsequent monthly charges need no further
// interaction — they're a signed payment against the mandate, capped by the
// constraints the trade agreed to. This is the ONLY flow where money moves to
// motko; customer pay-ins go direct to the trade (see truelayer-payments.ts).
//
// Networked module — must NOT be imported by any pure/deterministic helper.

import { randomUUID } from "node:crypto";
import { sign } from "truelayer-signing";
import {
  getMotkoFeeBeneficiary,
  getTrueLayerConfig,
  getTrueLayerSigning,
  type TrueLayerConfig,
} from "@/lib/truelayer";

const CREATE_MANDATE_PATH = "/v3/mandates";
// A charge against a mandate is a normal payment with payment_method.type =
// "mandate"; it hits the same signed /v3/payments endpoint as a one-off pay-in.
const CREATE_PAYMENT_PATH = "/v3/payments";

// cVRP constraints the trade agrees to at authorisation. The per-charge and
// per-calendar-month caps bound what motko can ever pull, well above a busy
// trade's monthly fee run (fees are £2–£4 per paid job) while still being a real
// ceiling. Values in pennies.
const MAX_INDIVIDUAL_AMOUNT_PENNIES = 200_000; // £2,000 per charge
const MAX_MONTHLY_AMOUNT_PENNIES = 200_000; // £2,000 per calendar month

// client_credentials token cache (scope "payments" covers both mandate creation
// and mandate charges). Separate from the payments module's cache by design —
// each networked module owns its own so neither depends on the other's internals.
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

export type CreateMandateParams = {
  // The trade authorising the mandate. Only `name` is required.
  user: { id?: string; name: string; email?: string };
  // Echoed on every mandate/payment webhook so we can map back to our records.
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export type TrueLayerMandate = {
  id: string;
  // Consumed by the hosted mandate page to send the trade to their bank to
  // authorise. Short-lived — build the HPP URL immediately, don't store it.
  resourceToken: string;
  status: string;
};

// Creates a commercial VRP mandate for motko to collect fees against. Throws
// when TrueLayer or the motko merchant beneficiary is unconfigured — callers
// surface this as "fee billing not available yet", never a silent success.
export const createTrueLayerMandate = async (
  params: CreateMandateParams,
): Promise<TrueLayerMandate> => {
  const config = getTrueLayerConfig();
  const signing = getTrueLayerSigning();
  const beneficiary = getMotkoFeeBeneficiary();
  if (!config || !signing || !beneficiary) {
    throw new Error("TrueLayer fee collection is not configured");
  }

  const token = await getAccessToken(config);
  const idempotencyKey = params.idempotencyKey ?? randomUUID();

  const user: Record<string, string> = { name: params.user.name };
  if (params.user.id) user.id = params.user.id;
  if (params.user.email) user.email = params.user.email;

  const body = JSON.stringify({
    mandate: {
      type: "commercial",
      provider_selection: { type: "user_selected" },
      beneficiary: {
        type: "merchant_account",
        merchant_account_id: beneficiary.merchantAccountId,
        account_holder_name: beneficiary.accountHolderName,
      },
    },
    currency: "GBP",
    constraints: {
      maximum_individual_amount: MAX_INDIVIDUAL_AMOUNT_PENNIES,
      periodic_limits: {
        month: {
          maximum_amount: MAX_MONTHLY_AMOUNT_PENNIES,
          period_alignment: "calendar",
        },
      },
    },
    user,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });

  const tlSignature = sign({
    kid: signing.kid,
    privateKeyPem: signing.privateKeyPem,
    path: CREATE_MANDATE_PATH,
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });

  const res = await fetch(`${config.apiBaseUrl}${CREATE_MANDATE_PATH}`, {
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
      `TrueLayer create mandate failed: ${res.status} ${await res.text()}`,
    );
  }

  const json = (await res.json()) as {
    id: string;
    resource_token: string;
    status: string;
  };
  return { id: json.id, resourceToken: json.resource_token, status: json.status };
};

// Reads a mandate's current status ("authorization_required" | "authorizing" |
// "authorized" | "failed" | "revoked"). Read-only GET — no Tl-Signature needed.
// Returns null when unconfigured or on any non-200 so callers can treat it as
// "not yet authorised" without throwing.
export const getTrueLayerMandateStatus = async (
  mandateId: string,
): Promise<{ id: string; status: string } | null> => {
  const config = getTrueLayerConfig();
  if (!config) return null;
  const token = await getAccessToken(config);
  const res = await fetch(
    `${config.apiBaseUrl}${CREATE_MANDATE_PATH}/${encodeURIComponent(mandateId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { id: string; status: string };
  return { id: json.id, status: json.status };
};

export type ChargeMandateParams = {
  mandateId: string;
  amountInMinor: number;
  // Statement reference the trade sees against the collection (<=18 chars).
  reference: string;
  // Echoed on the payment webhook — we stash fee_collection_id/contractor_id so
  // the webhook can settle the collection without a lookup column.
  metadata?: Record<string, string>;
  // Supply the fee_collection id so a redelivered batch never double-charges.
  idempotencyKey?: string;
};

export type TrueLayerMandatePayment = {
  id: string;
  status: string;
};

// Charges an amount against an authorised mandate — a signed /v3/payments call
// with payment_method.type "mandate". Throws when unconfigured or on a non-2xx
// so the caller marks the collection failed and enters dunning.
export const chargeMandate = async (
  params: ChargeMandateParams,
): Promise<TrueLayerMandatePayment> => {
  const config = getTrueLayerConfig();
  const signing = getTrueLayerSigning();
  if (!config || !signing) {
    throw new Error("TrueLayer fee collection is not configured");
  }

  const token = await getAccessToken(config);
  const idempotencyKey = params.idempotencyKey ?? randomUUID();

  const body = JSON.stringify({
    amount_in_minor: params.amountInMinor,
    currency: "GBP",
    payment_method: {
      type: "mandate",
      mandate_id: params.mandateId,
      reference: params.reference,
    },
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });

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
      `TrueLayer mandate charge failed: ${res.status} ${await res.text()}`,
    );
  }

  const json = (await res.json()) as { id: string; status: string };
  return { id: json.id, status: json.status };
};
