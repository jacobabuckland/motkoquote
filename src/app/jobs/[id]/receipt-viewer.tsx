"use client";

import { useState, useEffect } from "react";
import { getReceiptSignedUrl } from "./receipt-extract-actions";
import { Button } from "@/components/ui/button";

type ReceiptViewerProps = {
  evidenceUrl: string;
  onClose: () => void;
};

export function ReceiptViewer({ evidenceUrl, onClose }: ReceiptViewerProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSignedUrl = async () => {
      setLoading(true);
      setError(null);

      const result = await getReceiptSignedUrl(evidenceUrl);

      if (result.ok) {
        setSignedUrl(result.data.signedUrl);
      } else {
        setError(result.error);
      }

      setLoading(false);
    };

    fetchSignedUrl();
  }, [evidenceUrl]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="absolute top-4 right-4 z-10">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="bg-white text-black hover:bg-gray-200"
        >
          ✕ Close
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {loading && (
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Loading photo...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500 text-white rounded-md p-4 max-w-md">
            <p className="font-semibold">Failed to load photo</p>
            <p className="text-sm mt-2">{error}</p>
          </div>
        )}

        {signedUrl && !loading && !error && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedUrl}
            alt="Receipt"
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>
    </div>
  );
}
