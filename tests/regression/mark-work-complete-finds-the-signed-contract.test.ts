// 18 SEP: "Mark work complete" did nothing, on every job, five times over.
//
// It was not dead. It fired, the server refused it, and the refusal was
// swallowed — `haptics.error(); return;`, a buzz on a phone and nothing on the
// screen. A screen recording caught one card mid-transition on "Marking
// complete…", which is what a tap that registered and then silently lost looks
// like.
//
// THE REFUSAL WAS WRONG, and it was migration 83 catching up with a call site
// nobody revisited. `contracts` off a quote was a to-one OBJECT while
// `contracts.quote_id` was UNIQUE; 83 replaced that with a partial unique
// index, and PostgREST decides to-one versus to-many from exactly that
// constraint. `embeddedOne` reads both shapes, but on an array it returns
// `value[0]` in unspecified order and this select has no ORDER BY.
//
// So on the ordinary post-re-issue shape — two withdrawn contracts and the
// signed one — the guard usually inspected a dead contract and refused a job
// whose contract was signed, invoiced and PAID. All three jobs on the
// dashboard that day had exactly that shape.
//
// Asked correctly the question needs no ordering: is ANY contract on this job
// signed? A signed contract authorises completion whatever else happened, and
// `withdrawContract` refuses to withdraw a signed one, so a signature cannot
// go stale.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";

const JOB = "00000000-0000-4000-8000-000000000001";

const withdrawn = { status: "withdrawn", signed_at: null };
const declined = { status: "declined", signed_at: null };
const signedContract = { status: "signed", signed_at: "2026-09-17T13:45:00Z" };

/**
 * Drives the real server action against a job row shaped as PostgREST returns
 * it AFTER migration 83 — `contracts` an array, in the order the database felt
 * like. The dead ones come first, which is the case that was failing.
 */
const markComplete = async (
  contracts: { status: string; signed_at: string | null }[],
  complete = true,
) => {
  vi.resetModules();

  const { client } = mockSupabaseClient([
    { id: JOB, work_completed_at: null, quotes: [{ contracts }] },
  ]);
  const authed = Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
  });

  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => authed }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const mod = await import("@/app/jobs/actions");
  return mod.markWorkComplete({ jobId: JOB, complete });
};

beforeEach(() => {
  vi.resetModules();
});

describe("marking work complete on a job that has been re-issued", () => {
  it("accepts it when the signed contract is not the first in the embed", async () => {
    // The reported case, and the whole finding. Two withdrawn contracts sit
    // ahead of the signed one, which is what a withdraw-and-replace leaves.
    const result = await markComplete([withdrawn, withdrawn, signedContract]);

    expect(
      result,
      "a job whose contract is signed, invoiced and paid was refused completion " +
        "because the guard read whichever contract the embed happened to list first",
    ).toEqual({ success: true });
  });

  it("accepts it with a declined contract in the way too", async () => {
    const result = await markComplete([declined, withdrawn, signedContract]);

    expect(result).toEqual({ success: true });
  });

  it("still accepts the ordinary single signed contract", async () => {
    expect(await markComplete([signedContract])).toEqual({ success: true });
  });

  it("copes with the to-ONE shape, for any row that still arrives that way", async () => {
    // `embeddedMany` exists because the shape is not something a caller should
    // have to know. A bare object must behave exactly as a one-element array.
    vi.resetModules();
    const { client } = mockSupabaseClient([
      { id: JOB, work_completed_at: null, quotes: [{ contracts: signedContract }] },
    ]);
    const authed = Object.assign(client, {
      auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
    });
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => authed }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

    const mod = await import("@/app/jobs/actions");
    expect(await mod.markWorkComplete({ jobId: JOB, complete: true })).toEqual({
      success: true,
    });
  });
});

describe("what it must still refuse", () => {
  it("refuses a job where nothing has been signed", async () => {
    // The guard's actual purpose, unchanged. Loosening it to "a contract
    // exists" would let a contractor complete work the customer never agreed
    // to, which is the reason it is here.
    const result = await markComplete([withdrawn, declined]);

    expect(result).toEqual({
      error: "Work can only be marked complete after the contract is signed.",
    });
  });

  it("refuses a job with no contract at all", async () => {
    expect(await markComplete([])).toEqual({
      error: "Work can only be marked complete after the contract is signed.",
    });
  });

  it("lets an UNDO through regardless, so a misfire is always reversible", async () => {
    // Unchanged and deliberate: undoing has no signature guard.
    expect(await markComplete([withdrawn], false)).toEqual({ success: true });
  });
});
