// Disclosure state storage: same pattern as guest session.
// Try Capacitor Preferences (native), fall back to localStorage (web),
// degrade silently on failure.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

type DisclosureState = "open" | "closed";

const KEY_PREFIX = "motko.disclosure.";

/**
 * Load disclosure state from Preferences (native) or localStorage (web).
 * Returns null if not found or if storage is unavailable.
 *
 * Note: This is async to support Capacitor Preferences on native platforms.
 * On web it returns immediately, but callers must still await it.
 */
export async function loadDisclosureState(sectionId: string): Promise<DisclosureState | null> {
  const key = `${KEY_PREFIX}${sectionId}`;

  try {
    if (Capacitor.isNativePlatform()) {
      // Native: use Capacitor Preferences
      const result = await Preferences.get({ key });
      const value = result.value;
      if (value === "open" || value === "closed") {
        return value;
      }
      return null;
    } else {
      // Web: use localStorage
      if (typeof window === "undefined") return null;
      const value = window.localStorage.getItem(key);
      if (value === "open" || value === "closed") {
        return value;
      }
      return null;
    }
  } catch {
    // Silently degrade on storage failure
    return null;
  }
}

/**
 * Synchronous version for client-side initialization (web only).
 * Returns null on native platform or if storage unavailable.
 * Use this in useState initializers to avoid hydration mismatch.
 */
export function loadDisclosureStateSync(sectionId: string): DisclosureState | null {
  // Only works on web, not native
  if (typeof window === "undefined") return null;

  try {
    // On native, return null to force useEffect fallback
    if (Capacitor.isNativePlatform()) {
      return null;
    }

    // Web: use localStorage synchronously
    const key = `${KEY_PREFIX}${sectionId}`;
    const value = window.localStorage.getItem(key);
    if (value === "open" || value === "closed") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save disclosure state to Preferences (native) or localStorage (web).
 * Fails silently if storage is unavailable.
 */
export async function saveDisclosureState(
  sectionId: string,
  state: DisclosureState,
): Promise<void> {
  const key = `${KEY_PREFIX}${sectionId}`;

  try {
    if (Capacitor.isNativePlatform()) {
      // Native: use Capacitor Preferences
      await Preferences.set({ key, value: state });
    } else {
      // Web: use localStorage
      if (typeof window === "undefined") return;
      window.localStorage.setItem(key, state);
    }
  } catch {
    // Silently degrade on storage failure (quota exceeded, write-blocked)
  }
}
