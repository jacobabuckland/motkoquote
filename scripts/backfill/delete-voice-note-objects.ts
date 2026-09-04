#!/usr/bin/env tsx

/**
 * PFIX-6: Delete orphaned voice-note storage objects
 *
 * A deliberate two-step:
 *   - Bare invocation lists what it would delete (bucket, object count, total bytes, owner folder)
 *   - `--confirm` performs the deletion
 *
 * Idempotent: second run reports zero and exits 0.
 *
 * Usage:
 *   npx tsx scripts/backfill/delete-voice-note-objects.ts          # list only
 *   npx tsx scripts/backfill/delete-voice-note-objects.ts --confirm # delete
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET = "voice-notes";

const main = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "SUPABASE credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false },
  });

  // List all objects in the voice-notes bucket
  const { data: allFiles, error: listError } = await admin.storage.from(BUCKET).list("", {
    limit: 1000,
    sortBy: { column: "created_at", order: "asc" },
  });

  if (listError) {
    console.error(`Failed to list objects in ${BUCKET}: ${listError.message}`);
    process.exit(1);
  }

  if (!allFiles || allFiles.length === 0) {
    console.log(`No objects found in ${BUCKET} bucket. Nothing to delete.`);
    process.exit(0);
  }

  // Get owner folders (each folder is an owner's user_id)
  const ownerFolders = allFiles.filter((f) => f.id === null).map((f) => f.name);

  // For each owner folder, list the files inside
  let totalFiles = 0;
  let totalBytes = 0;
  const allPaths: string[] = [];

  for (const ownerId of ownerFolders) {
    const { data: files, error } = await admin.storage.from(BUCKET).list(ownerId, {
      limit: 1000,
    });

    if (error) {
      console.error(`Failed to list objects for owner ${ownerId}: ${error.message}`);
      process.exit(1);
    }

    if (files && files.length > 0) {
      totalFiles += files.length;
      totalBytes += files.reduce((sum, f) => sum + (f.metadata?.size ?? 0), 0);

      for (const file of files) {
        allPaths.push(`${ownerId}/${file.name}`);
      }
    }
  }

  // Report what would be deleted
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Objects: ${totalFiles}`);
  console.log(`Total size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Owner folders: ${ownerFolders.length}`);
  console.log();

  if (!process.argv.includes("--confirm")) {
    console.log("Run with --confirm to delete these objects.");
    process.exit(0);
  }

  // Delete the objects
  if (allPaths.length > 0) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(allPaths);

    if (removeError) {
      console.error(`Failed to remove objects from ${BUCKET}: ${removeError.message}`);
      process.exit(1);
    }

    console.log(`Successfully deleted ${totalFiles} objects from ${BUCKET}.`);
  }

  process.exit(0);
};

main();
