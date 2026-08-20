// Disclosure state storage: same pattern as guest session (localStorage with
// silent degradation). No Capacitor Preferences: that package is not installed,
// and disclosure state is UI state only, not critical data worth syncing.

type DisclosureState = "open" | "closed";

const KEY_PREFIX = "motko.disclosure.";

const storage = (): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    const candidate = window.localStorage;
    // Touch it: merely reading `localStorage` succeeds in some privacy modes
    // that then throw on write.
    const probe = "__motko_disclosure_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
};

/**
 * Load disclosure state from localStorage.
 * Returns null if not found or if storage is unavailable.
 */
export function loadDisclosureState(sectionId: string): DisclosureState | null {
  const key = `${KEY_PREFIX}${sectionId}`;
  const store = storage();
  if (!store) return null;

  try {
    const value = store.getItem(key);
    if (value === "open" || value === "closed") {
      return value;
    }
    return null;
  } catch {
    // Silently degrade on storage failure
    return null;
  }
}

/**
 * Save disclosure state to localStorage.
 * Fails silently if storage is unavailable.
 */
export function saveDisclosureState(
  sectionId: string,
  state: DisclosureState,
): void {
  const key = `${KEY_PREFIX}${sectionId}`;
  const store = storage();
  if (!store) return;

  try {
    store.setItem(key, state);
  } catch {
    // Silently degrade on storage failure (quota exceeded, write-blocked)
  }
}
