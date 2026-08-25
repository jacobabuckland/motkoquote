"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Public logo URLs look like `.../object/public/logos/{uid}/logo-….png`; pull
// the storage path back out so we can delete the object on replace/remove.
const pathFromPublicUrl = (url: string): string | null => {
  const marker = "/logos/";
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
};

type Props = {
  value?: string;
  onChange: (url: string | undefined) => void;
};

export const LogoUpload = ({ value, onChange }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The storage layer's own words, shown in small print under the sentence.
  //
  // The upload used to fail with a fixed "Upload failed — try again." while
  // `uploadError.message` — bucket missing, RLS denial, MIME rejection, 5xx —
  // was discarded on the very line that reported the failure. A trade retried
  // the same file and got the same six words, and nobody could tell which of
  // those causes it was. Reported as failing on EVERY valid upload, so it is
  // systematic rather than file-specific, and the detail is the whole
  // diagnosis.
  const [detail, setDetail] = useState<string | null>(null);

  const openPicker = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);
    setDetail(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Keep the file under 2MB.");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Sign in again to upload.");
      setUploading(false);
      return;
    }

    // No `upsert`, deliberately. The path carries a millisecond timestamp, so
    // it cannot collide and upsert bought nothing — but it sends `x-upsert`,
    // which makes the storage layer resolve whether the object already exists
    // before choosing insert-vs-update, and that existence check needs SELECT
    // on storage.objects. Migration 15 gives the `logos` bucket insert, update
    // and delete policies and NO select — the only bucket in the repo missing
    // one (voice_notes and receipts both have it). `public: true` does not
    // cover it: that grants anonymous read through the public URL endpoint,
    // which is a different path from an RLS SELECT for an authenticated client.
    //
    // That is the only candidate that predicts a 100% failure rate, which is
    // what is reported. Dropping the flag removes the need for SELECT entirely
    // and is safe whatever the real cause turns out to be.
    const path = `${user.id}/logo-${Date.now()}.${EXTENSION[file.type]}`;
    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(path, file, { contentType: file.type });

    if (uploadError) {
      setError("Couldn't upload that logo.");
      setDetail(uploadError.message || null);
      setUploading(false);
      return;
    }

    // Best-effort cleanup of the previous logo so old files don't pile up.
    const previousPath = value ? pathFromPublicUrl(value) : null;
    if (previousPath && previousPath !== path) {
      await supabase.storage.from("logos").remove([previousPath]);
    }

    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
  };

  const handleRemove = async () => {
    const previousPath = value ? pathFromPublicUrl(value) : null;
    if (previousPath) {
      await createClient().storage.from("logos").remove([previousPath]);
    }
    onChange(undefined);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-secondary">Logo</span>
      <span className="text-xs font-normal text-text-muted">
        Shown on your quotes, contracts and PDFs. PNG, JPG or WebP, up to 2MB.
      </span>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      <div className="mt-1 flex flex-wrap items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from Supabase storage
          <img
            src={value}
            alt="Business logo"
            className="h-16 w-16 rounded-control border border-border bg-surface object-contain p-1"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-control border border-dashed border-border bg-surface text-xs text-text-muted">
            No logo
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={openPicker}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : value ? "Replace" : "Upload logo"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="tertiary"
              onClick={() => void handleRemove()}
              disabled={uploading}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-error">{error}</p>
          {/* Small print, because it is the storage layer talking rather than
              us. A trade cannot act on "new row violates row-level security
              policy" — but they can read it down the phone, and it is the
              difference between a report and a diagnosis. */}
          {detail && <p className="text-xs text-text-muted">{detail}</p>}
        </div>
      )}
    </div>
  );
};
