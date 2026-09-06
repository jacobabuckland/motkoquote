-- Referral Liability Query: Total unconsumed banked subscription months
--
-- Calculates the total number of banked subscription months owed to contractors
-- based on their activated referrals. Every 5 activated referrals credits 1 banked month.
--
-- Calculation: For each contractor, FLOOR(activated_referral_count / 5) gives their
-- banked months. We sum this across all contractors to get the total liability.
--
-- Returns: A single integer representing total unconsumed banked months (never NULL).
-- If no contractors exist or none have 5+ activations, returns 0.

SELECT COALESCE(total, 0) AS total_banked_months
FROM (
  SELECT SUM(FLOOR(activated_referral_count / 5)) AS total
  FROM contractors
) AS subquery;
