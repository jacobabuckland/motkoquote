import { Capacitor } from "@capacitor/core";

// Uppercase deliberately: these are the values of the plugin's own
// ImpactStyle enum (Light = "LIGHT", Medium = "MEDIUM"). The lowercase
// strings this shipped with are silently wrong on a device — the plugin
// does not recognise them. Literals rather than the enum itself so the
// shared Capacitor test mock does not need to export it.
let Haptics: typeof import("@capacitor/haptics").Haptics | null = null;

// Dynamically import Capacitor Haptics only on native platforms
if (Capacitor.isNativePlatform()) {
  const mod = await import("@capacitor/haptics");
  Haptics = mod.Haptics;
}

export function tap(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects lowercase "light" but Capacitor types use ImpactStyle enum
      Haptics.impact({ style: "LIGHT" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function press(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects lowercase "medium" but Capacitor types use ImpactStyle enum
      Haptics.impact({ style: "MEDIUM" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function success(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - NotificationType enum requires uppercase literal
      Haptics.notification({ type: "SUCCESS" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function error(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - NotificationType enum requires uppercase literal
      Haptics.notification({ type: "ERROR" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function select(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Capacitor provides selectionChanged, not selection
      Haptics.selectionChanged().catch(() => {});
    } catch {}
  }

  return undefined;
}
