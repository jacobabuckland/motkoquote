-- Add activated_referral_count column to contractors table
-- This is a monotonic counter tracking how many referrals a contractor has activated.
-- Unlike free_jobs_remaining (which goes down as credits are spent), this counter
-- only goes up, so we can compute the reward tier (3 for activations 1-4, 5 for 5+).

ALTER TABLE contractors
ADD COLUMN activated_referral_count INTEGER NOT NULL DEFAULT 0;

-- Backfill activated_referral_count from historical referrals where status = 'activated'
-- Count the number of activated referrals for each referrer_contractor_id
UPDATE contractors
SET activated_referral_count = (
  SELECT COUNT(*)
  FROM referrals
  WHERE referrals.referrer_contractor_id = contractors.id
    AND referrals.status = 'activated'
);
