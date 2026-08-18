"use client";

import { useState } from "react";
import { Camera, CameraSource, CameraResultType } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Dialog } from "@capacitor/dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type ReceiptCaptureProps = {
  userId: string;
  onPhotoUploaded: (photoUrl: string) => void;
  onCancel: () => void;
};

export function ReceiptCapture({ userId, onPhotoUploaded, onCancel }: ReceiptCaptureProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadPhoto = async (base64Data: string) => {
    setUploading(true);
    setError(null);

    try {
      // Convert base64 to blob
      const response = await fetch(`data:image/jpeg;base64,${base64Data}`);
      const blob = await response.blob();

      // Generate a unique filename
      const timestamp = Date.now();
      const filename = `${userId}/${timestamp}.jpg`;

      // Upload to Supabase storage
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(filename, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      setUploading(false);
      onPhotoUploaded(filename);
    } catch (err) {
      setUploading(false);
      console.error("Upload error:", err);

      // Check if it's a network error
      if (err instanceof Error && err.message.includes("Failed to fetch")) {
        setError("No internet connection. Try again when online.");
      } else {
        setError("Failed to upload photo. Try again.");
      }
    }
  };

  const handleTakePhoto = async () => {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        quality: 80,
        width: 1920,
        correctOrientation: true,
        resultType: CameraResultType.Base64,
      });

      if (photo.base64String) {
        await uploadPhoto(photo.base64String);
      }
    } catch (err) {
      console.error("Camera error:", err);

      // Check if permission was denied
      if (err instanceof Error && err.message.includes("denied")) {
        // Fall back to photo library
        handleChooseFromLibrary();
      } else {
        setError("Failed to take photo. Try again.");
      }
    }
  };

  const handleChooseFromLibrary = async () => {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        quality: 80,
        width: 1920,
        correctOrientation: true,
        resultType: CameraResultType.Base64,
      });

      if (photo.base64String) {
        await uploadPhoto(photo.base64String);
      }
    } catch (err) {
      console.error("Photo library error:", err);

      // Check if permission was denied
      if (err instanceof Error && err.message.includes("denied")) {
        // Fall back to manual entry
        onCancel();
      } else {
        setError("Failed to choose photo. Try again.");
      }
    }
  };

  const showActionSheet = async () => {
    if (Capacitor.isNativePlatform()) {
      // On native platforms, use the native action sheet
      const { value } = await Dialog.confirm({
        title: "Add receipt photo",
        message: "Choose a photo source:",
        okButtonTitle: "Take photo",
        cancelButtonTitle: "Choose from library",
      });

      if (value) {
        handleTakePhoto();
      } else {
        handleChooseFromLibrary();
      }
    } else {
      // On web, show a simple dialog
      const { value } = await Dialog.confirm({
        title: "Add receipt photo",
        message: "Choose a photo source:",
        okButtonTitle: "Take photo",
        cancelButtonTitle: "Choose from library",
      });

      if (value) {
        handleTakePhoto();
      } else {
        handleChooseFromLibrary();
      }
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Add receipt photo</h3>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="primary"
          onClick={showActionSheet}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Choose photo"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
