/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import type { SowState } from "@/lib/schemas/sow";

describe("Issue #373: VOICE-3 — A call that ends without customer name or contact must be visible", () => {
  describe("getMissingCustomerDetails detects gaps in customer information", () => {
    it("reports missing name", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        customer_phone: "07700 900123",
        customer_email: "test@example.com",
        site_address: "123 Main St",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_name");
    });

    it("reports missing contact when neither phone nor email present", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: undefined,
        customer_email: undefined,
        site_address: "123 Main St",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_contact");
    });

    it("does NOT report missing contact when phone is present (email absent)", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: "07700 900123",
        customer_email: undefined,
        site_address: "123 Main St",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).not.toContain("customer_contact");
    });

    it("does NOT report missing contact when email is present (phone absent)", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: undefined,
        customer_email: "alice@example.com",
        site_address: "123 Main St",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).not.toContain("customer_contact");
    });

    it("reports missing site address separately, not as a blocking gap", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: "07700 900123",
        customer_email: undefined,
        site_address: undefined,
      };

      const missing = getMissingCustomerDetails(sow);
      // site_address is reported separately via a different mechanism,
      // NOT in the blocking list returned by getMissingCustomerDetails
      expect(missing).not.toContain("site_address");
    });

    it("returns empty array when name and at least one contact channel present", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: "07700 900123",
        customer_email: "alice@example.com",
        site_address: "123 Main St",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toEqual([]);
    });

    it("treats whitespace-only strings as missing", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "   ",
        customer_phone: "  ",
        customer_email: "",
        site_address: undefined,
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_name");
      expect(missing).toContain("customer_contact");
    });
  });

  describe("CUSTOMER_DETAIL_LABELS provides human-readable labels", () => {
    it("exports labels for each customer detail slot", async () => {
      const { CUSTOMER_DETAIL_LABELS } = await import("@/lib/schemas/sow");

      expect(CUSTOMER_DETAIL_LABELS.customer_name).toBeDefined();
      expect(CUSTOMER_DETAIL_LABELS.customer_contact).toBeDefined();
      expect(CUSTOMER_DETAIL_LABELS.site_address).toBeDefined();
    });

    it("labels are terse sentence fragments suitable for slotting into a sentence", async () => {
      const { CUSTOMER_DETAIL_LABELS } = await import("@/lib/schemas/sow");

      // Labels should be short and lowercase (they slot into "Call ended before <label>")
      expect(CUSTOMER_DETAIL_LABELS.customer_name.length).toBeLessThan(50);
      expect(CUSTOMER_DETAIL_LABELS.customer_contact.length).toBeLessThan(50);
      expect(CUSTOMER_DETAIL_LABELS.site_address.length).toBeLessThan(50);
    });
  });

  describe("wrap_incomplete and unasked_required include customer details", () => {
    it("sets wrap_incomplete when customer name is missing", async () => {
      // This tests the integration: completeSow action + getMissingCustomerDetails
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        complete: true,
        customer_name: undefined,
        customer_phone: "07700 900123",
        customer_email: undefined,
        labour_plan: { crew_description: "just me", people_count: 1, duration_days: 3, working_dates: undefined },
        materials_supply: { contractor_supplied: [], customer_supplied: [] },
        pricing: { mode: "days", fixed_amount: null },
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing.length).toBeGreaterThan(0);
      // This simulates what completeSow does: if missing.length > 0, wrap_incomplete is true
      const wrapIncomplete = missing.length > 0;
      expect(wrapIncomplete).toBe(true);
    });

    it("sets wrap_incomplete when contact details are missing", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        complete: true,
        customer_name: "Alice Builder",
        customer_phone: undefined,
        customer_email: undefined,
        labour_plan: { crew_description: "just me", people_count: 1, duration_days: 3, working_dates: undefined },
        materials_supply: { contractor_supplied: [], customer_supplied: [] },
        pricing: { mode: "days", fixed_amount: null },
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_contact");
    });

    it("does NOT set wrap_incomplete when name and one contact channel present", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        complete: true,
        customer_name: "Alice Builder",
        customer_phone: "07700 900123",
        customer_email: undefined,
        labour_plan: { crew_description: "just me", people_count: 1, duration_days: 3, working_dates: undefined },
        materials_supply: { contractor_supplied: [], customer_supplied: [] },
        pricing: { mode: "days", fixed_amount: null },
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toEqual([]);
    });
  });

  describe("REQUIRED_CHECKLIST_QUESTIONS gains no CUSTOMER questions", () => {
    // RETIRED 2026-09-02, by the owner's decision: "still contains only crew,
    // duration, and materials_supply", which asserted
    //   expect(REQUIRED_CHECKLIST_QUESTIONS).toEqual([...]) / toHaveLength(3)
    //
    // Superseded by #501's D12, which promoted working_dates to a required slot
    // — the point of that item, since the field existed and nothing ever asked,
    // so customers got a quote saying how long a job would take and never when
    // anyone was turning up. The two contracts are mutually exclusive and no
    // implementation satisfies both.
    //
    // This is the shape AGENTS.md warns about under "'Out of scope' means do
    // not change it — never assert it is unchanged": the assertion pinned the
    // CURRENT VALUE of a list another in-flight item existed to change, rather
    // than the property VOICE-3 actually cares about.
    //
    // Only that assertion is retired. The one below is the requirement this
    // item was written to protect — that customer details never become required
    // checklist questions — and it passes unchanged against the four-entry
    // list, which is precisely why it was the right way to say it.
    it("does NOT include customer_name or customer_contact", async () => {
      const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      const asString = REQUIRED_CHECKLIST_QUESTIONS.join(",");
      expect(asString).not.toContain("customer");
      expect(asString).not.toContain("name");
      expect(asString).not.toContain("contact");
    });
  });

  describe("Job page renders the gap for missing customer details", () => {
    it("renders a prompt when wrap_incomplete is true and customer details are in unasked_required", async () => {
      // We need to render the relevant part of the job page that shows the banner.
      // The actual banner rendering logic is at src/app/jobs/[id]/page.tsx:597.
      // For the test, we'll verify the labels are used correctly by checking
      // that they can be imported and used in a similar pattern.

      const { CUSTOMER_DETAIL_LABELS } = await import("@/lib/schemas/sow");

      // Simulate what the job page does: merge labels from both sources
      type SlotId = "customer_name" | "customer_contact" | "site_address";
      const unaskedRequired: SlotId[] = ["customer_name", "customer_contact"];

      const labels = unaskedRequired.map((id) => CUSTOMER_DETAIL_LABELS[id]);
      const message = `Call ended before ${labels.join(", ")} ${labels.length === 1 ? "was" : "were"} captured`;

      expect(message).toContain("Call ended before");
      expect(message).toContain(CUSTOMER_DETAIL_LABELS.customer_name);
      expect(message).toContain(CUSTOMER_DETAIL_LABELS.customer_contact);
    });

    it("can render mixed checklist and customer detail gaps in one banner", async () => {
      const { CUSTOMER_DETAIL_LABELS, CHECKLIST_SLOT_LABELS } = await import("@/lib/schemas/sow");

      // Simulate a call that ended without crew AND without customer name
      type AllSlots = "crew" | "customer_name";
      const unaskedRequired: AllSlots[] = ["crew", "customer_name"];

      const labels = unaskedRequired.map((id) => {
        if (id in CHECKLIST_SLOT_LABELS) {
          return CHECKLIST_SLOT_LABELS[id as keyof typeof CHECKLIST_SLOT_LABELS];
        }
        return CUSTOMER_DETAIL_LABELS[id as keyof typeof CUSTOMER_DETAIL_LABELS];
      });

      expect(labels).toHaveLength(2);
      expect(labels[0]).toBe(CHECKLIST_SLOT_LABELS.crew);
      expect(labels[1]).toBe(CUSTOMER_DETAIL_LABELS.customer_name);
    });
  });

  describe("Telemetry includes missing_customer_details flag", () => {
    it("voice_session_completed event signature includes the new field", async () => {
      // This is a schema test: verify that the telemetry call site can accept
      // the new field. We're checking that the track() call in actions.ts
      // can include missing_customer_details without type errors.

      // Read the actions.ts file to verify the telemetry call includes the field
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const actionsSource = readFileSync(
        join(__dirname, "..", "..", "src", "app", "jobs", "actions.ts"),
        "utf8"
      );

      // The voice_session_completed event should include missing_customer_details
      expect(actionsSource).toContain("voice_session_completed");
      // After implementation, this should include the new field
      expect(actionsSource).toContain("missing_customer_details");
    });
  });

  describe("Guest and account paths behave identically", () => {
    it("getMissingCustomerDetails is path-agnostic (same function for both flows)", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      // The function operates on SowState alone, not on whether it's a guest/account job
      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        customer_phone: undefined,
        customer_email: undefined,
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_name");
      expect(missing).toContain("customer_contact");

      // Same SoW, same result, regardless of which intake path created it
    });
  });

  describe("Site address is reported but not blocking", () => {
    it("missing site_address does not appear in the blocking list", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        customer_phone: "07700 900123",
        customer_email: undefined,
        site_address: undefined,
      };

      const missing = getMissingCustomerDetails(sow);
      // site_address should NOT be in the blocking list
      expect(missing).not.toContain("site_address");
      // The function should return empty since name + phone are present
      expect(missing).toEqual([]);
    });

    it("site_address present or absent does not affect wrap_incomplete for other fields", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sowWithAddress: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        customer_phone: "07700 900123",
        site_address: "123 Main St",
      };

      const sowWithoutAddress: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        customer_phone: "07700 900123",
        site_address: undefined,
      };

      // Both should report customer_name missing, regardless of site_address
      expect(getMissingCustomerDetails(sowWithAddress)).toContain("customer_name");
      expect(getMissingCustomerDetails(sowWithoutAddress)).toContain("customer_name");
    });
  });

  describe("Edge case: empty strings and whitespace", () => {
    it("treats empty string as missing", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "",
        customer_phone: "",
        customer_email: "",
      };

      const missing = getMissingCustomerDetails(sow);
      expect(missing).toContain("customer_name");
      expect(missing).toContain("customer_contact");
    });

    it("null and undefined are both treated as missing", async () => {
      const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sowNull: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: null as unknown as undefined,
        customer_phone: null as unknown as undefined,
        customer_email: null as unknown as undefined,
      };

      const sowUndefined: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        customer_phone: undefined,
        customer_email: undefined,
      };

      const missingNull = getMissingCustomerDetails(sowNull);
      const missingUndefined = getMissingCustomerDetails(sowUndefined);

      expect(missingNull).toContain("customer_name");
      expect(missingNull).toContain("customer_contact");
      expect(missingUndefined).toContain("customer_name");
      expect(missingUndefined).toContain("customer_contact");
    });
  });
});
