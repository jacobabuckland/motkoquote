"use client";

import { useToast } from "./toast";

// Compact inline "Copy link" action (G7): copies a URL to the clipboard and
// confirms with a toast. Sized to sit inside a PipelineRow's action slot.
export const CopyLinkButton = ({
  url,
  label = "Copy link",
  copiedMessage = "Link copied.",
}: {
  url: string;
  label?: string;
  // The confirmation toast. Defaults to the link wording; callers copying
  // something else (e.g. a referral code) pass their own so the toast names
  // what was actually copied rather than always saying "Link copied.".
  copiedMessage?: string;
}) => {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast(copiedMessage);
        } catch {
          toast("Couldn't copy — try again.");
        }
      }}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover"
    >
      {label}
    </button>
  );
};
