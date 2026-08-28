import { describe, expect, it } from "vitest";
import { materialsResponsibility, materialsSummary } from "@/lib/materials-summary";
import { contractPrefillFromJob } from "@/lib/contract-prefill";
import type { MaterialsSupply } from "@/lib/schemas/job";

// One captured field, rendered three ways, one of them inverted. On the
// reviewed job the tradesperson said he was supplying everything, and the
// documents said: "Customer supplying materials" (SoW, Not included),
// "Supplied by us" (SoW, Materials), and every material itemised as charged
// (quote). On a signed document that inversion is the argument the
// tradesperson loses.

const contractorSuppliesAll: MaterialsSupply = {
  contractor_supplied: ["consumer unit", "SWA cable", "outdoor socket"],
  customer_supplied: [],
};

const job = (materials_supply: MaterialsSupply | null) => ({
  customer: null,
  extracted_json: { scope_items: ["Consumer unit"], materials_supply },
});

describe("materialsResponsibility", () => {
  it("says Contractor when the contractor supplies everything", () => {
    expect(materialsResponsibility(contractorSuppliesAll).by).toBe("Contractor");
  });

  it("says Customer when the customer supplies everything", () => {
    expect(
      materialsResponsibility({ contractor_supplied: [], customer_supplied: ["tiles"] }).by,
    ).toBe("Customer");
  });

  it("names both and details the split in notes", () => {
    const split = materialsResponsibility({
      contractor_supplied: ["adhesive"],
      customer_supplied: ["tiles"],
    });

    expect(split.by).toBe("Contractor and customer (see notes)");
    expect(split.notes).toContain("Supplied by contractor: adhesive");
    expect(split.notes).toContain("Supplied by customer: tiles");
  });

  it("stays blank when the question was never answered", () => {
    // Better an empty editable field than a contract asserting something
    // nobody said.
    expect(materialsResponsibility(null)).toEqual({ by: "", notes: "" });
    expect(
      materialsResponsibility({ contractor_supplied: [], customer_supplied: [] }),
    ).toEqual({ by: "", notes: "" });
  });
});

describe("the documents agree about who supplies materials", () => {
  it("contract and statement of work cannot state opposite answers", () => {
    const contract = contractPrefillFromJob(job(contractorSuppliesAll));
    const sow = materialsSummary(
      contractorSuppliesAll.contractor_supplied,
      contractorSuppliesAll,
    );

    // The contract names the contractor...
    expect(contract.materials_by).toBe("Contractor");
    // ...and the SoW attributes the same materials to "us", never the customer.
    expect(sow.supplySentence).toContain("Supplied by us:");
    expect(sow.supplySentence).not.toContain("Supplied by customer");
  });

  it("inverts together, not separately", () => {
    const customerSupplies: MaterialsSupply = {
      contractor_supplied: [],
      customer_supplied: ["tiles"],
    };
    const contract = contractPrefillFromJob(job(customerSupplies));
    const sow = materialsSummary(customerSupplies.customer_supplied, customerSupplies);

    expect(contract.materials_by).toBe("Customer");
    expect(sow.supplySentence).toContain("Supplied by customer:");
    expect(sow.supplySentence).not.toContain("Supplied by us");
  });

  it("leaves the contract blank when the SoW has nothing to say either", () => {
    const contract = contractPrefillFromJob(job(null));
    const sow = materialsSummary([], null);

    expect(contract.materials_by).toBe("");
    expect(sow.supplySentence).toBeNull();
  });
});
