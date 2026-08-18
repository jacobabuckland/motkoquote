import type { SowState } from "@/lib/schemas/sow";
import type { GuestQuote } from "@/lib/guest/quote";

// The guest session: a client-side object and nothing else.
//
// It holds the in-progress job and the generated quote. It has no user id, no
// row anywhere, and no identifier that is ever sent to our database — the
// reference on the artefact is generated in the browser purely so the same
// string appears on screen and on the PDF.
//
// Storage is in-memory first with a local-storage MIRROR, in that order. The
// mirror is what survives the app being backgrounded and the WKWebView being
// evicted; when local storage is unavailable or full (Safari private mode,
// quota exhausted) every write here fails silently and the flow continues
// in-memory only. Degrading is the specified behaviour: guest mode must never
// error out or gate on storage.

export const GUEST_ARTEFACT_VERSION = 1;
export const GUEST_STORAGE_KEY = "motko.guest.artefact.v1";

export type GuestArtefact = {
  version: typeof GUEST_ARTEFACT_VERSION;
  // Client-side only. Used for the document reference and to tell one guest
  // job from the next; never transmitted to our database.
  reference: string;
  createdAt: string;
  updatedAt: string;
  sow: SowState | null;
  transcript: string[];
  quote: GuestQuote | null;
};

// The authoritative copy for the lifetime of the tab. Local storage is a
// mirror of this, never the other way round.
let memory: GuestArtefact | null = null;

const storage = (): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    const candidate = window.localStorage;
    // Touch it: merely reading `localStorage` succeeds in some privacy modes
    // that then throw on write.
    const probe = "__motko_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
};

const isArtefact = (value: unknown): value is GuestArtefact => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuestArtefact>;
  return (
    candidate.version === GUEST_ARTEFACT_VERSION &&
    typeof candidate.reference === "string" &&
    typeof candidate.createdAt === "string"
  );
};

const mirror = (artefact: GuestArtefact | null): void => {
  const store = storage();
  if (!store) return;
  try {
    if (artefact === null) store.removeItem(GUEST_STORAGE_KEY);
    else store.setItem(GUEST_STORAGE_KEY, JSON.stringify(artefact));
  } catch {
    // Quota exhausted or write-blocked — in-memory remains authoritative and
    // the flow completes. Nothing to recover, nothing to report to the user.
  }
};

/** The current guest artefact, rehydrating from the mirror on a cold mount. */
export const readGuestArtefact = (): GuestArtefact | null => {
  if (memory) return memory;

  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(GUEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isArtefact(parsed)) {
      store.removeItem(GUEST_STORAGE_KEY);
      return null;
    }
    memory = parsed;
    return memory;
  } catch {
    return null;
  }
};

/** True when a guest has work in progress worth preserving. */
export const hasGuestArtefact = (): boolean => {
  const artefact = readGuestArtefact();
  return Boolean(artefact && (artefact.quote || artefact.sow || artefact.transcript.length > 0));
};

export const writeGuestArtefact = (artefact: GuestArtefact): GuestArtefact => {
  memory = { ...artefact, updatedAt: new Date().toISOString() };
  mirror(memory);
  return memory;
};

export const updateGuestArtefact = (
  patch: Partial<Omit<GuestArtefact, "version" | "reference" | "createdAt">>,
): GuestArtefact | null => {
  const current = readGuestArtefact();
  if (!current) return null;
  return writeGuestArtefact({ ...current, ...patch });
};

export const startGuestArtefact = (reference: string): GuestArtefact => {
  const now = new Date().toISOString();
  return writeGuestArtefact({
    version: GUEST_ARTEFACT_VERSION,
    reference,
    createdAt: now,
    updatedAt: now,
    sow: null,
    transcript: [],
    quote: null,
  });
};

/**
 * Discards the guest artefact. Only ever ONE is retained — starting a second
 * job replaces the first (the caller warns before calling this), and signing in
 * or signing up discards it silently. There is deliberately no queue: an
 * unbounded pile of local drafts is a support problem, not a feature.
 */
export const clearGuestArtefact = (): void => {
  memory = null;
  mirror(null);
};
