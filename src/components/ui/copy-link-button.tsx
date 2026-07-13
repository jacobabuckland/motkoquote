"use client";

import { useToast } from "./toast";

// Compact inline "Copy link" action (G7): copies a URL to the clipboard and
// confirms with a toast. Sized to sit inside a PipelineRow's action slot.
export const CopyLinkButton = ({
  url,
  label = "Copy link",
}: {
  url: string;
  label?: string;
}) => {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copied");
        } catch {
          toast("Couldn't copy — try again");
        }
      }}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover"
    >
      {label}
    </button>
  );
};
