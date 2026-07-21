// TrueLayer (open-banking PISP) configuration.
//
// motko initiates a pay-by-bank payment that pushes the FULL amount straight
// from the customer's bank to the trade's own account over Faster Payments —
// motko never touches the money. The motko fee is billed separately (see
// motko-fee.ts + fee_collections), never deducted from this payment.
//
// This module only resolves credentials + environment. It returns null when
// unconfigured (mirrors getStripeClient) so nothing throws at import time in
// environments without TrueLayer set up. The actual payment-creation call
// (which requires request signing, below) is wired in Phase 3 once the signing
// key is provisioned.

export type TrueLayerEnv = "sandbox" | "live";

export type TrueLayerConfig = {
  clientId: string;
  clientSecret: string;
  env: TrueLayerEnv;
  // OAuth token endpoint host (client_credentials, scope "payments").
  authBaseUrl: string;
  // Payments API host.
  apiBaseUrl: string;
};

const HOSTS: Record<TrueLayerEnv, { auth: string; api: string }> = {
  sandbox: {
    auth: "https://auth.truelayer-sandbox.com",
    api: "https://api.truelayer-sandbox.com",
  },
  live: {
    auth: "https://auth.truelayer.com",
    api: "https://api.truelayer.com",
  },
};

// Hosted Payment Page hosts. The HPP is a TrueLayer-hosted redirect the customer
// authorises the pay-by-bank transfer on; we build its URL ourselves from the
// payment id + resource token (see buildHostedPaymentPageUrl).
const HPP_HOSTS: Record<TrueLayerEnv, string> = {
  sandbox: "https://payment.truelayer-sandbox.com",
  live: "https://payment.truelayer.com",
};

const resolveEnv = (): TrueLayerEnv =>
  process.env.TRUELAYER_ENV === "live" ? "live" : "sandbox";

// Builds the Hosted Payment Page URL for a freshly-created payment. The customer
// is sent here to authorise with their bank, then redirected back to returnUri
// (TrueLayer appends `?payment_id=...`, plus `&error=tl_hpp_abandoned` if they
// cancelled). Payments expire 15 min after creation if authorisation hasn't
// started, so this URL is short-lived — build it at pay-page load, not earlier.
// Pure (no I/O) so it stays trivially testable.
export const buildHostedPaymentPageUrl = (
  env: TrueLayerEnv,
  payment: { id: string; resourceToken: string },
  returnUri: string,
): string =>
  `${HPP_HOSTS[env]}/payments#payment_id=${payment.id}` +
  `&resource_token=${payment.resourceToken}` +
  `&return_uri=${encodeURIComponent(returnUri)}`;

// Hosted mandate-authorisation page. Unlike a one-off payment, a commercial VRP
// (cVRP) mandate is authorised ONCE by the trade at their bank; motko then pulls
// each monthly fee against it with no further interaction. The trade is sent
// here to authorise; TrueLayer redirects back to returnUri afterwards. Pure.
export const buildMandateHostedPageUrl = (
  env: TrueLayerEnv,
  mandate: { id: string; resourceToken: string },
  returnUri: string,
): string =>
  `${HPP_HOSTS[env]}/mandates#mandate_id=${mandate.id}` +
  `&resource_token=${mandate.resourceToken}` +
  `&return_uri=${encodeURIComponent(returnUri)}`;

// The motko-side beneficiary that fee collections are pulled INTO. This is the
// one place money flows to motko (the trade's pay-ins go direct to the trade,
// never here). It's a TrueLayer-managed merchant account, referenced by id, so
// no raw sort code/account number lives in our config. Returns null when
// unconfigured so the fee-collection path degrades gracefully.
export type MotkoFeeBeneficiary = {
  merchantAccountId: string;
  accountHolderName: string;
};

export const getMotkoFeeBeneficiary = (): MotkoFeeBeneficiary | null => {
  const merchantAccountId = process.env.TRUELAYER_MERCHANT_ACCOUNT_ID;
  if (!merchantAccountId) return null;
  return {
    merchantAccountId,
    accountHolderName: process.env.MOTKO_FEE_BENEFICIARY_NAME ?? "Motko",
  };
};

// Returns the resolved config, or null when client id/secret are absent — so
// callers degrade gracefully (no pay-by-bank link) exactly like the Stripe path
// does before onboarding is complete.
export const getTrueLayerConfig = (): TrueLayerConfig | null => {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const env = resolveEnv();
  const hosts = HOSTS[env];
  return {
    clientId,
    clientSecret,
    env,
    authBaseUrl: hosts.auth,
    apiBaseUrl: hosts.api,
  };
};

// Request-signing material for TrueLayer's payments API. Every mutating call
// (create payment, create payout) must carry a `Tl-Signature` JWS produced with
// this ES512/P-521 key; the matching public key is registered with TrueLayer
// under `kid`. The private key is provisioned as base64-encoded PEM in the env
// (so it survives single-line env storage) and decoded here. Returns null when
// unconfigured, mirroring getTrueLayerConfig so callers degrade gracefully.
export type TrueLayerSigning = {
  kid: string;
  privateKeyPem: string;
};

export const getTrueLayerSigning = (): TrueLayerSigning | null => {
  const kid = process.env.TRUELAYER_SIGNING_KID;
  const privateKeyB64 = process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64;
  if (!kid || !privateKeyB64) return null;
  const privateKeyPem = Buffer.from(privateKeyB64, "base64").toString("utf8");
  return { kid, privateKeyPem };
};
