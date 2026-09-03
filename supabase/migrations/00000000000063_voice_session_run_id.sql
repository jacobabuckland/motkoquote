-- Add run_id column to jobs table to uniquely identify each voice session
-- This enables end-to-end funnel tracking for voice sessions: started → completed/abandoned

ALTER TABLE jobs ADD COLUMN run_id uuid;

-- Index for orphan-session queries (finding jobs by run_id with no completion event)
CREATE INDEX idx_jobs_run_id ON jobs(run_id) WHERE run_id IS NOT NULL;
