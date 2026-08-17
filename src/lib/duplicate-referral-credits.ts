// Re-export the duplicate detection helper from settle-paid-job.ts
// The actual implementation lives there; this file exists to satisfy
// test imports that check both locations.
export { detectDuplicateReferralCredits } from "./settle-paid-job";
