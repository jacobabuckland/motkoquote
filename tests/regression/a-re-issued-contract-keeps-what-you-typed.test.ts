// PASS-13 SERIOUS 4: a re-issue threw away everything the contractor typed.
//
// After withdrawing, the contract form came back with "What work are you doing?
// (required)" empty, along with exclusions, materials notes, access
// arrangements and additional terms. Only the addresses and the warranty period
// survived — and those survived because they are DERIVED from the job every
// time, so they were never the contractor's words to lose.
//
// The contract being replaced holds exactly the shape the form submits, in
// `contracts.job_input_json`. Nothing read it.
import { describe, expect, it } from "vitest";
import { contractToInheritFrom, withPreviousContractInput } from "@/lib/contract-prefill";

const derived = {
  scope_of_work: "Strip out existing suite; Tile walls and floor",
  access_arrangements: "",
  client_address: "1 Example Street",
  client_phone: "07700 900123",
  site_address: "1 Example Street",
  materials_by: "contractor",
  materials_notes: "",
  exclusions: "",
  special_terms: "",
  warranty_period: "12 months",
};

describe("what a re-issued contract inherits", () => {
  it("keeps the scope of works the contractor wrote, over the one derived from the job", () => {
    // The reported case. The contractor rewrote the scope in their own words;
    // the derived version is a semicolon-joined list of SoW items.
    const previous = { scope_of_work: "Full bathroom refurbishment including soil stack" };

    expect(withPreviousContractInput(derived, previous).scope_of_work).toBe(
      "Full bathroom refurbishment including soil stack",
    );
  });

  it("keeps every field the contractor typed that the job cannot derive", () => {
    const previous = {
      exclusions: "Making good to decoration",
      access_arrangements: "Key safe, code on the day",
      special_terms: "Parking permit supplied by the client",
      materials_notes: "Tiles supplied by the client",
    };

    const result = withPreviousContractInput(derived, previous);

    expect(result.exclusions).toBe("Making good to decoration");
    expect(result.access_arrangements).toBe("Key safe, code on the day");
    expect(result.special_terms).toBe("Parking permit supplied by the client");
    expect(result.materials_notes).toBe("Tiles supplied by the client");
  });

  it("does NOT let an empty field on the old contract blank a derived one", () => {
    // The load-bearing case. An empty string is not an answer, and treating it
    // as one would make a re-issue WORSE than a first issue — which is the
    // failure this exists to remove, arriving from the other direction.
    const previous = { scope_of_work: "", client_address: "   ", warranty_period: "" };

    const result = withPreviousContractInput(derived, previous);

    expect(result.scope_of_work).toBe("Strip out existing suite; Tile walls and floor");
    expect(result.client_address).toBe("1 Example Street");
    expect(result.warranty_period).toBe("12 months");
  });

  it("never carries timing across", () => {
    // start_date, completion_date and estimated_duration are structured inputs
    // with their own seeded props, and the form refuses prose timing from
    // prefill. A replacement contract usually needs new dates anyway — stale
    // ones are the likeliest reason it is being re-issued.
    const previous = {
      start_date: "2026-01-01",
      completion_date: "2026-02-01",
      estimated_duration: "5 days",
    };

    const result = withPreviousContractInput(derived, previous) as Record<string, unknown>;

    expect(result.start_date).toBeUndefined();
    expect(result.completion_date).toBeUndefined();
    expect(result.estimated_duration).toBeUndefined();
  });

  it("is a no-op on a first contract, when there is nothing to inherit", () => {
    expect(withPreviousContractInput(derived, null)).toEqual(derived);
    expect(withPreviousContractInput(derived, undefined)).toEqual(derived);
  });
});

describe("which contract a re-issue inherits from", () => {
  const withdrawn = { id: "c1", status: "withdrawn", sent_at: "2026-09-12T09:00:00Z" };
  const declined = { id: "c0", status: "declined", sent_at: "2026-09-09T09:00:00Z" };

  it("takes the most recently sent, whatever its status", () => {
    // Deliberately NOT the live contract: a re-issue is drafted precisely
    // because the last one was withdrawn or declined, so the dead one carries
    // the words worth keeping.
    expect(contractToInheritFrom([declined, withdrawn])?.id).toBe("c1");
    expect(contractToInheritFrom([withdrawn, declined])?.id).toBe("c1");
  });

  it("says nothing when the quote has no contract yet", () => {
    expect(contractToInheritFrom([])).toBeNull();
  });

  it("copes with a contract that has no sent_at", () => {
    const neverSent = { id: "c2", status: "withdrawn", sent_at: null };
    expect(contractToInheritFrom([neverSent, withdrawn])?.id).toBe("c1");
    expect(contractToInheritFrom([neverSent])?.id).toBe("c2");
  });
});
