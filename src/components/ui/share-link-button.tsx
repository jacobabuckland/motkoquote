"use client";

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Haptics, type ImpactStyle } from "@capacitor/haptics";
import { useState } from "react";
// This button paints its own toast rather than using the provider, so the two
// used to carry a copied class string that could drift. One definition now.
import { TOAST_BUBBLE_CLASS, TOAST_LAYER_CLASS } from "@/components/ui/toast";

export const ShareLinkButton = ({
  url,
  title,
  label = "Share link",
}: {
  url: string;
  title: string;
  label?: string;
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleClick = async () => {
    if (Capacitor.isNativePlatform()) {
      // Native platform: use share sheet with haptics
      // Uppercase: the plugin's ImpactStyle enum is Medium = "MEDIUM", and the
      // lowercase form it does not recognise fails silently on a device (#96).
      // A literal with a cast, so the shared Capacitor mock need not export it.
      void Haptics.impact({ style: "MEDIUM" as ImpactStyle });
      void Share.share({
        title,
        url,
      });
    } else {
      // Web platform: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        showToast("Link copied.");
      } catch {
        showToast("Couldn't copy — try again.");
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover"
      >
        {label}
      </button>
      {toastMessage && (
        <div className={TOAST_LAYER_CLASS} aria-live="polite" data-testid="toast-layer">
          <div className={TOAST_BUBBLE_CLASS}>{toastMessage}</div>
        </div>
      )}
    </>
  );
};
