# Motko — App Store Launch Checklist

State: **Ready to upload** — App Store Connect record exists, signing/provisioning set up.
Remaining work is: flip one entitlement, archive, upload to TestFlight, fill listing, submit.

App identity: appId `app.motko.ios` · name **Motko** · Team `79Q8PR5SA8` · web target `https://motko.app`.

---

## 1. Pre-archive (do in this order)

- [ ] **Flip `aps-environment` → `production`** in `ios/App/App/App.entitlements`
      (currently `development`; token-based APNs must match the production gateway).
- [ ] Confirm `APNS_ENV` in Vercel Production is **empty or not `sandbox`** — verified empty,
      so `src/lib/push/apns.ts` uses the production gateway. ✅
- [ ] Bump build number: `CURRENT_PROJECT_VERSION` (currently `1`). Marketing version `MARKETING_VERSION` = `1.0`.
- [ ] `cd /Users/jacob/motkoquote-ios && pnpm build && npx cap sync ios` so the native shell is current.
- [ ] Open `ios/App/App.xcworkspace` in Xcode (NOT the `.xcodeproj`), select **Any iOS Device (arm64)**.

## 2. Archive & upload

- [ ] Product → Archive.
- [ ] In Organizer: Validate App → fix any errors → Distribute App → App Store Connect → Upload.
- [ ] Expect NO ITMS-91053 (privacy manifest declares UserDefaults CA92.1). ✅ shipped in PR #27.
- [ ] Wait for TestFlight processing, then add yourself as an internal tester and smoke-test:
      login, voice → quote, invoice email, Stripe payment link, push notification.

## 3. App Store Connect — listing metadata

- [ ] **Name:** Motko
- [ ] **Subtitle** (30 chars): e.g. `Quotes & invoices by voice`
- [ ] **Category:** Business (secondary: Productivity)
- [ ] **Description:** what it does — voice note → branded quote → invoice → chasing, for UK contractors.
- [ ] **Keywords** (100 chars, comma-sep, no spaces): `quote,invoice,contractor,tradesperson,voice,estimate,builder,plumber,electrician,uk`
- [ ] **Support URL** + **Marketing URL:** https://motko.app
- [ ] **Promotional text** (optional, editable without review).

## 4. Screenshots (required)

- [ ] 6.9" display (iPhone 16 Pro Max, 1320×2868) — **required**.
- [ ] 6.5" display (1284×2778 or 1242×2688) — required if not auto-scaled.
- [ ] iPad 12.9" only if you enable iPad — Info.plist supports iPad orientations, so decide iPhone-only vs universal.
- [ ] Capture from a real device or simulator running TestFlight build.

## 5. App Privacy questionnaire

Match the shipped `PrivacyInfo.xcprivacy` (no tracking, no data collection declared there).
- [ ] Data collection: declare what the **backend** actually stores (account email, business
      details, customer/quote/invoice data). The privacy manifest only covers on-device
      required-reason APIs — the App Store questionnaire covers server-side collection too.
- [ ] Tracking: **No** (NSPrivacyTracking=false).
- [ ] Provide Privacy Policy URL (required if any data collected).

## 6. Compliance & review notes

- [ ] Export compliance: `ITSAppUsesNonExemptEncryption=false` shipped → no extra docs. ✅
- [ ] **Microphone** usage string present (`NSMicrophoneUsageDescription`). ✅
- [ ] Sign-in required → provide a **demo account** in "App Review Information" (reviewers can't sign up as a real contractor).
- [ ] Note that payments are handled by **Stripe** for physical/off-platform services (not IAP) — confirm you're not selling digital goods that would require IAP.
- [ ] Age rating questionnaire.

## 7. Submit

- [ ] Assign the processed TestFlight build to the App Store version.
- [ ] Answer any remaining metadata prompts, then **Submit for Review**.
- [ ] Choose manual vs automatic release.

---

## Parallel (Jacob-owned) — Stripe Pay by Bank

- [ ] Enable **Pay by Bank** in the Stripe Dashboard (Settings → Payment methods).
- [ ] Subscribe the webhook endpoint to `checkout.session.async_payment_succeeded`
      (and optionally `async_payment_failed`) — required for delayed settlement.
- [ ] Test-mode E2E: create an invoice ≤ £10k, complete + abandon a Pay by Bank payment,
      verify invoice status settles on success and stays payable on abandonment.
