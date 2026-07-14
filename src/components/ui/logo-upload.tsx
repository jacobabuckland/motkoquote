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

  const openPicker = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);

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

    const path = `${user.id}/logo-${Date.now()}.${EXTENSION[file.type]}`;
    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setError("Upload failed — try again.");
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

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
};
