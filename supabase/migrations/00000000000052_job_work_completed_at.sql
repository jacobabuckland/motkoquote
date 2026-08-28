-- Add work_completed_at column to jobs table
-- This is the first stored pipeline state: a timestamp recording when the
-- contractor marks the work as done, gating invoice creation in a future item.

ALTER TABLE jobs
ADD COLUMN work_completed_at timestamptz;

-- Nullable deliberately: legacy jobs and in-progress jobs have it null.
-- No default, no index — this is read once per job page load and written once
-- per completion toggle, so an index would cost more than it saves.
