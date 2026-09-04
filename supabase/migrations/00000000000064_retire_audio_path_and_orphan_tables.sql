-- PFIX-6: Retire the dead audio-capture path and three orphan tables
--
-- 1. Drops three orphan tables (client_errors, feedback, rate_limits) that exist on
--    production, are created by no migration, and are written by no code
-- 2. Drops jobs.source_audio_url column (no writer)
-- 3. Drops voice-notes bucket policies
--
-- PREREQUISITE: The voice-notes bucket must be empty before running this migration.
-- Run scripts/backfill/delete-voice-note-objects.ts --confirm first.

-- Verify the voice-notes bucket is empty before proceeding
DO $$
DECLARE
  object_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO object_count
  FROM storage.objects
  WHERE bucket_id = 'voice-notes';

  IF object_count > 0 THEN
    RAISE EXCEPTION 'voice-notes bucket is not empty (% objects remain). Run the deletion script first.', object_count;
  END IF;
END $$;

-- Drop the three orphan tables
DROP TABLE IF EXISTS client_errors;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS rate_limits;

-- Drop jobs.source_audio_url column
ALTER TABLE jobs DROP COLUMN IF EXISTS source_audio_url;

-- Drop voice-notes bucket policies (created in migration 00000000000004)
-- These control access to the voice-notes storage bucket
DROP POLICY IF EXISTS "Users upload own voice notes" ON storage.objects; -- voice-notes
DROP POLICY IF EXISTS "Users read own voice notes" ON storage.objects; -- voice-notes
