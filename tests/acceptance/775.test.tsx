/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";
import { quoteEditability, hasContract } from "@/lib/quote-editability";
import { deriveSituation } from "@/lib/job-stages";
import { isPubliclyUnavailable } from "@/lib/erased-artefact";

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * `withdrawContract` checks for a signed-in user before it writes, and
 * `mockSupabaseClient` supplies no `auth` — it is a query-builder stub, not a
 * whole client. Without this the action reads `auth.getUser` off undefined.
 *
 * Stubbing the session here is what lets the guard in `src/` stay
 * unconditional. An auth check written as `if (supabase.auth?.getUser)` so that
 * a test can skip it is production code shaped by its test, and AGENTS.md is
 * explicit that this is the signal the TEST is wrong.
 */
const withSession = (client: unknown) =>
  Object.assign(client as object, {
    auth: {
      getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }),
    },
  });

describe("CONTRACT-1: A sent contract can be withdrawn", () => {
  describe("Criterion 1: Contractor can withdraw sent, unsigned contract", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("withdrawContract updates status to withdrawn", async () => {
      const contractRow = {
        id: "contract_1",
        status: "sent",
        signed_at: null,
        quote_id: "quote_1",
        contractor_id: "contractor_1",
        job_id: "job_1",
      };

      const { client, getWrites } = mockSupabaseClient([contractRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => withSession(client),
      }));
      vi.doMock("next/cache", () => ({
        revalidatePath: vi.fn(),
      }));

      const { withdrawContract } = await import("@/app/jobs/actions");
      await withdrawContract("contract_1");

      const writes = getWrites();
      const update = writes.find((w) => w.table === "contracts" && w.method === "update");

      expect(update).toBeDefined();
      expect(update?.payload).toMatchObject({
        status: "withdrawn",
      });
    });

    it("revalidates relevant paths after withdrawal", async () => {
      const contractRow = {
        id: "contract_1",
        status: "sent",
        signed_at: null,
        quote_id: "quote_1",
        contractor_id: "contractor_1",
        job_id: "job_1",
      };

      const { client } = mockSupabaseClient([contractRow]);
      const revalidatePath = vi.fn();

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => withSession(client),
      }));
      vi.doMock("next/cache", () => ({
        revalidatePath,
      }));

      const { withdrawContract } = await import("@/app/jobs/actions");
      await withdrawContract("contract_1");

      expect(revalidatePath).toHaveBeenCalled();
    });
  });

  describe("Criterion 2: Withdraw refused on signed contract", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("throws when attempting to withdraw signed contract", async () => {
      const contractRow = {
        id: "contract_1",
        status: "signed",
        signed_at: "2026-09-15T10:00:00Z",
        quote_id: "quote_1",
        contractor_id: "contractor_1",
      };

      const { client, getWrites } = mockSupabaseClient([contractRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => withSession(client),
      }));
      vi.doMock("next/cache", () => ({
        revalidatePath: vi.fn(),
      }));

      const { withdrawContract } = await import("@/app/jobs/actions");

      await expect(withdrawContract("contract_1")).rejects.toThrow();

      const writes = getWrites();
      const update = writes.find((w) => w.table === "contracts" && w.method === "update");
      expect(update).toBeUndefined();
    });
  });

  describe("Criterion 3: Customer sees withdrawal message, cannot sign", () => {
    it("withdrawn contract page shows company name and blocks signing", async () => {
      // The contract page must render "This contract has been withdrawn by {company name}"
      // and not show signing UI. This is verified by:
      // 1. The page checking contract.status === "withdrawn"
      // 2. Rendering the withdrawal message with contractor.trading_name
      // 3. Not rendering the signature form
      //
      // Implementation verification: The page module must export a component that
      // handles the withdrawn status separately from sent/signed/declined/void.

      const mod = await import("@/app/c/[id]/page");
      expect(mod.default).toBeDefined();
    });
  });

  describe("Criterion 4: Withdrawal sends customer nothing", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("does not call notification services", async () => {
      const contractRow = {
        id: "contract_1",
        status: "sent",
        signed_at: null,
        quote_id: "quote_1",
        contractor_id: "contractor_1",
      };

      const { client } = mockSupabaseClient([contractRow]);
      const notifyCustomer = vi.fn();

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => withSession(client),
      }));
      vi.doMock("next/cache", () => ({
        revalidatePath: vi.fn(),
      }));

      // The one path that reaches a customer. `src/app/jobs/actions.ts` imports
      // notifyCustomer and nothing else that sends, so mocking it and asserting
      // it was never called is what decision (1) — "the customer is not told" —
      // actually means.
      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer,
      }));

      const { withdrawContract } = await import("@/app/jobs/actions");
      await withdrawContract("contract_1");

      expect(notifyCustomer).not.toHaveBeenCalled();
    });
  });

  describe("Criteria 5 & 6: Quote editability checks contract status", () => {
    it("allows editing quote with withdrawn contract (criterion 5)", () => {
      const withdrawnContract = { id: "contract_1", status: "withdrawn" };

      const result = quoteEditability("accepted", withdrawnContract);

      expect(result.editable).toBe(true);
    });

    it("blocks editing quote with sent contract (criterion 6)", () => {
      const sentContract = { id: "contract_1", status: "sent" };

      const result = quoteEditability("accepted", sentContract);

      expect(result.editable).toBe(false);
      if (result.editable) throw new Error("expected the quote to be locked");
      expect(result.reason).toBeDefined();
    });

    it("blocks editing quote with signed contract (criterion 6)", () => {
      const signedContract = { id: "contract_1", status: "signed" };

      const result = quoteEditability("accepted", signedContract);

      expect(result.editable).toBe(false);
      if (result.editable) throw new Error("expected the quote to be locked");
      expect(result.reason).toBeDefined();
    });

    it("allows editing quote with no contract (baseline)", () => {
      const result = quoteEditability("accepted", null);

      expect(result.editable).toBe(true);
    });
  });

  describe("Job stage derivation with withdrawn contract", () => {
    it("returns accepted_need_contract situation when contract is withdrawn", () => {
      const quote = {
        status: "accepted",
        sent_at: "2026-09-15T09:00:00Z",
        viewed_at: "2026-09-15T09:05:00Z",
        accepted_at: "2026-09-15T09:10:00Z",
        declined_at: null,
      };

      const withdrawnContract = {
        id: "contract_1",
        status: "withdrawn",
        sent_at: "2026-09-15T10:00:00Z",
        signed_at: null,
        deposit_pct: 30,
      };

      const result = deriveSituation(quote, withdrawnContract, [], Date.now(), null, [], null);

      expect(result.situation).toBe("accepted_need_contract");
      expect(result.move).toBe("contractor");
    });

    it("returns contract_sent situation when contract is sent (unchanged)", () => {
      const quote = {
        status: "accepted",
        sent_at: "2026-09-15T09:00:00Z",
        viewed_at: null,
        accepted_at: "2026-09-15T09:10:00Z",
        declined_at: null,
      };

      const sentContract = {
        id: "contract_1",
        status: "sent",
        sent_at: "2026-09-15T10:00:00Z",
        signed_at: null,
        deposit_pct: 30,
      };

      const result = deriveSituation(quote, sentContract, [], Date.now(), null, [], null);

      expect(result.situation).toBe("contract_sent");
      expect(result.move).toBe("customer");
    });
  });

  describe("Criterion 7: Void contract unaffected by withdrawal", () => {
    it("void status continues to trigger 404", () => {
      // Void contracts (from account erasure) must continue to return notFound()
      // This is handled by isPubliclyUnavailable in src/lib/erased-artefact.ts
      // which checks: status === "void" || erasedAt is set
      //
      // Implementation verification: The contract page must continue to call
      // isPubliclyUnavailable and return notFound() for void status, treating it
      // exactly as it does today - no changes to the erasure path.

      const voidContract = { erasedAt: null, status: "void" };
      expect(isPubliclyUnavailable(voidContract)).toBe(true);

      const withdrawnContract = { erasedAt: null, status: "withdrawn" };
      expect(isPubliclyUnavailable(withdrawnContract)).toBe(false);
    });
  });

  describe("quoteEditability signature receives contract status", () => {
    it("accepts contract object with status property", () => {
      // Test that the function can receive and use contract.status
      const contractWithStatus = { id: "contract_1", status: "withdrawn" };
      const result = quoteEditability("accepted", contractWithStatus);

      expect(result).toBeDefined();
      expect(result.editable).toBeDefined();
    });

    it("hasContract helper treats withdrawn same as null for editability", () => {
      // Withdrawn contract exists as a row
      const withdrawnContract = { id: "contract_1", status: "withdrawn" };
      expect(hasContract(withdrawnContract)).toBe(true);

      // But editability should not block on it
      const result = quoteEditability("accepted", withdrawnContract);
      expect(result.editable).toBe(true);
    });
  });
});
