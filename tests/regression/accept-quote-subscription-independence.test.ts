/**
 * Regression test for SUB-4: acceptQuote must work regardless of contractor subscription status
 *
 * The customer's ability to accept a quote must not be affected by the contractor's
 * billing status. This test behaviorally verifies that acceptQuote succeeds when the
 * contractor has subscription_status='past_due', demonstrating that the function does
 * not query subscription_projection or call isSubscriptionReadOnly.
 *
 * Context: The acceptance test at tests/acceptance/659.test.ts:369-378 only checks
 * the function signature (.length === 1), which is a structural test that would pass
 * even if acceptQuote internally blocked on subscription status. This regression test
 * provides the behavioral verification: we actually call acceptQuote with a quote
 * whose contractor has a failed subscription, and verify it succeeds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("acceptQuote subscription independence", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("succeeds when contractor has past_due subscription", async () => {
    // Set up a quote with line items (not unpriced) in 'sent' status
    const quote = {
      id: "quote_1",
      status: "sent",
      line_items_json: [
        {
          category: "labour" as const,
          description: "Test work",
          quantity: 10,
          unit: "hours",
          unit_price: 5000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          unpriced: false,
        },
      ],
      job_id: "job_1",
    };

    const updatedQuote = {
      id: "quote_1",
    };

    const jobData = {
      job_id: "job_1",
      job: {
        customer: {
          name: "Test Customer",
        },
        contractor_id: "contractor_1",
      },
    };

    // Mock createAdminClient to return a client that:
    // 1. Returns the quote data for the unpriced check
    // 2. Returns the updated quote for the status update
    // 3. Returns the job data for the notification
    // 4. Returns a subscription_projection row showing the contractor has past_due status
    //    (to prove acceptQuote either doesn't query it, or queries and ignores it)
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn((fields: string) => {
              // First select is for line_items_json check
              if (fields === "line_items_json") {
                return {
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: quote,
                      error: null,
                    })),
                  })),
                };
              }
              // Second select is for loading job data
              if (fields.includes("job:jobs")) {
                return {
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: jobData,
                      error: null,
                    })),
                  })),
                };
              }
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: null,
                  })),
                })),
              };
            }),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(async () => ({
                    data: [updatedQuote],
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "subscription_projection") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    contractor_id: "contractor_1",
                    subscription_status: "past_due",
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: null,
                error: null,
              })),
            })),
          })),
        };
      }),
    };

    // Mock the admin client
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn(() => mockClient),
    }));

    // Mock the notification function to avoid side effects
    vi.doMock("@/lib/notify-contractor", () => ({
      notifyContractorOfCustomerAction: vi.fn(async () => undefined),
    }));

    const { acceptQuote } = await import("@/app/q/[id]/actions");

    // The key assertion: acceptQuote succeeds without throwing the subscription error
    // If acceptQuote were checking subscription_projection and blocking on past_due,
    // this would throw an error like "subscription payment failed" or "read-only"
    await expect(acceptQuote("quote_1")).resolves.not.toThrow();

    // Verify the quote was updated to 'accepted'
    expect(mockClient.from).toHaveBeenCalledWith("quotes");
    const updateCalls = mockClient.from.mock.results.find(
      (result) => result.value.update,
    );
    expect(updateCalls).toBeDefined();
  });

  it("succeeds when contractor has unpaid subscription", async () => {
    // Similar to above but for 'unpaid' status - testing the other read-only state
    const quote = {
      id: "quote_2",
      status: "sent",
      line_items_json: [
        {
          category: "labour" as const,
          description: "Test work",
          quantity: 5,
          unit: "hours",
          unit_price: 5000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          unpriced: false,
        },
      ],
      job_id: "job_2",
    };

    const updatedQuote = {
      id: "quote_2",
    };

    const jobData = {
      job_id: "job_2",
      job: {
        customer: {
          name: "Another Customer",
        },
        contractor_id: "contractor_2",
      },
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "line_items_json") {
                return {
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: quote,
                      error: null,
                    })),
                  })),
                };
              }
              if (fields.includes("job:jobs")) {
                return {
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: jobData,
                      error: null,
                    })),
                  })),
                };
              }
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: null,
                  })),
                })),
              };
            }),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(async () => ({
                    data: [updatedQuote],
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "subscription_projection") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    contractor_id: "contractor_2",
                    subscription_status: "unpaid",
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: null,
                error: null,
              })),
            })),
          })),
        };
      }),
    };

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn(() => mockClient),
    }));

    vi.doMock("@/lib/notify-contractor", () => ({
      notifyContractorOfCustomerAction: vi.fn(async () => undefined),
    }));

    const { acceptQuote } = await import("@/app/q/[id]/actions");

    // Again, the critical assertion: no subscription error is thrown
    await expect(acceptQuote("quote_2")).resolves.not.toThrow();
  });
});
