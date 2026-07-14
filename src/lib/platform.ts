// Runtime platform detection. The app is one server-rendered codebase served
// both to browsers and, once shipped, to the Capacitor iOS shell pointing at
// the same origin. Capacitor injects a global `Capacitor` object into the
// WKWebView, so its presence is how we tell the native container apart from a
// plain browser tab. Used to branch push registration (APNs device token in
// the app vs VAPID web push on the web) and to hide web-only affordances.
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

const getCapacitor = (): CapacitorGlobal | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
};

// True only inside the Capacitor native shell (iOS/Android app), false in any
// browser and during server rendering.
export const isNativeApp = (): boolean => {
  const capacitor = getCapacitor();
  return capacitor?.isNativePlatform?.() ?? false;
};

// The concrete platform string Capacitor reports ("ios" | "android" | "web").
// Falls back to "web" outside the native shell.
export const getPlatform = (): string => {
  const capacitor = getCapacitor();
  return capacitor?.getPlatform?.() ?? "web";
};
