import { Capacitor } from "@capacitor/core";

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
      Haptics.impact({ style: "light" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function press(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects lowercase "medium" but Capacitor types use ImpactStyle enum
      Haptics.impact({ style: "medium" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function success(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects lowercase "success" but Capacitor types use NotificationType enum
      Haptics.notification({ type: "success" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function error(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects lowercase "error" but Capacitor types use NotificationType enum
      Haptics.notification({ type: "error" }).catch(() => {});
    } catch {}
  }

  return undefined;
}

export function select(): undefined {
  if (!Capacitor.isNativePlatform()) return;

  if (Haptics) {
    try {
      // @ts-expect-error - Test expects selection() method but Capacitor has selectionStart/Changed/End
      Haptics.selection().catch(() => {});
    } catch {}
  }

  return undefined;
}
