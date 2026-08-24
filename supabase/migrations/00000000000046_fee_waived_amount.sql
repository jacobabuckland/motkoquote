-- FEE-2: Cap what one free job can waive at the base band
--
-- Add `fee_waived_amount_pennies` to record the portion of the fee waived by a
-- free-job credit (capped at the base-band fee). The existing `fee_amount_pennies`
-- becomes the payable amount (what's actually charged), and their sum equals the
-- full computed band fee.

-- Add the column, nullable like the other fee columns
ALTER TABLE jobs ADD COLUMN fee_waived_amount_pennies int;

-- Backfill existing waived jobs. These were settled before FEE-2 landed, so the
-- entire fee was waived (fee_amount_pennies = 0). We backfill the waived amount
-- based on the job value: £2 for jobs ≤ £1,000, £4 for jobs > £1,000.
--
-- This is for auditability only — no money is recalculated or re-collected.
UPDATE jobs
SET fee_waived_amount_pennies = CASE
  WHEN job_value_pennies <= 100000 THEN 200  -- Base band: £2
  ELSE 400                                     -- Large band: £4
END
WHERE fee_waived_reason = 'free_allowance'
  AND fee_amount_pennies = 0;
