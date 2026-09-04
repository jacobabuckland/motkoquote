/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUEST_STORAGE_KEY } from "@/lib/guest/session";

// Each case needs a module instance whose in-memory copy is empty, so the
// local-storage mirror is genuinely what is being exercised (rather than the
// module-level cache from a previous case).
const freshSession = async () => {
  vi.resetModules();
  return import("@/lib/guest/session");
};

describe("guest artefact survives the app being backgrounded", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rehydrates the in-progress job and generated quote from the mirror", async () => {
    const first = await freshSession();
    const started = first.startGuestArtefact("ABCD1234");
    first.updateGuestArtefact({
      transcript: ["Full rewire, three-bed semi"],
      quote: {
        reference: "ABCD1234",
        createdAt: started.createdAt,
        jobType: "Full rewire",
        lineItems: [],
        subtotal: 1200,
        total: 1200,
        customer: { name: "Luca Feser" },
        contractorFlags: [],
        unpricedLabour: false,
        unpricedMaterials: false,
      },
    });

    // A new module instance stands in for the WKWebView being evicted and the
    // page re-mounting on resume — memory is gone, the mirror is not.
    const afterResume = await freshSession();
    const recovered = afterResume.readGuestArtefact();

    expect(recovered?.reference).toBe("ABCD1234");
    expect(recovered?.transcript).toEqual(["Full rewire, three-bed semi"]);
    expect(recovered?.quote?.total).toBe(1200);
    expect(afterResume.hasGuestArtefact()).toBe(true);
  });

  it("retains only the most recent artefact", async () => {
    const session = await freshSession();
    session.startGuestArtefact("FIRST111");
    session.startGuestArtefact("SECOND22");

    expect(session.readGuestArtefact()?.reference).toBe("SECOND22");
    const stored = JSON.parse(window.localStorage.getItem(GUEST_STORAGE_KEY) ?? "{}") as {
      reference?: string;
    };
    expect(stored.reference).toBe("SECOND22");
  });

  it("discards silently on sign-in", async () => {
    const session = await freshSession();
    session.startGuestArtefact("ABCD1234");
    session.clearGuestArtefact();

    expect(session.readGuestArtefact()).toBeNull();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });

  it("degrades to in-memory when local storage is unavailable, and still completes", async () => {
    const session = await freshSession();
    // Safari private mode and a full quota both surface as a throwing setItem.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    // No throw, and the artefact is still usable for the rest of the flow.
    const artefact = session.startGuestArtefact("ABCD1234");
    expect(artefact.reference).toBe("ABCD1234");
    expect(session.readGuestArtefact()?.reference).toBe("ABCD1234");
    expect(session.hasGuestArtefact()).toBe(false); // nothing captured yet

    session.updateGuestArtefact({ transcript: ["said something"] });
    expect(session.hasGuestArtefact()).toBe(true);
  });

  it("ignores a corrupt or foreign-versioned mirror rather than throwing", async () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "{not json");
    const session = await freshSession();
    expect(session.readGuestArtefact()).toBeNull();

    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ version: 99 }));
    const next = await freshSession();
    expect(next.readGuestArtefact()).toBeNull();
  });

  it("never puts a user id or any server identifier on the artefact", async () => {
    const session = await freshSession();
    session.startGuestArtefact("ABCD1234");
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY) ?? "";

    expect(raw).not.toMatch(/user_id|userId|contractor_id|job_id|jobId/);
  });
});
