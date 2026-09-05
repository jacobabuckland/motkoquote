-- SUB-2: Three free jobs, waiving the transaction fee only
--
-- Changes the default for contractors.free_jobs_remaining from 5 to 3,
-- aligning with the ledger grant of 3 that has been shipping since #330 (FEE-1).
-- After this migration: free_jobs_remaining int not null default 3

alter table contractors
  alter column free_jobs_remaining set default 3;

-- This changes only the DEFAULT for new rows. Existing contractors are corrected
-- by the nightly reconcileFreeJobs cron, which is already the mechanism that keeps
-- the cache in sync with the ledger.
