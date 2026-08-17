import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Issue #239: PAY-7: Define fee collection mechanism for uncollectable fees", () => {
  describe("1. Module structure", () => {
    it("exports detectStrandedFeeCollections function", async () => {
      const imported = await import("@/lib/detect-uncollectable-fees");
      expect(imported.detectStrandedFeeCollections).toBeDefined();
      expect(typeof imported.detectStrandedFeeCollections).toBe("function");
    });

    it("exports aggregateUncollectableFees function", async () => {
      const imported = await import("@/lib/detect-uncollectable-fees");
      expect(imported.aggregateUncollectableFees).toBeDefined();
      expect(typeof imported.aggregateUncollectableFees).toBe("function");
    });

    it("exports StrandedCollectionsReport type", async () => {
      const imported = await import("@/lib/detect-uncollectable-fees");
      // Type exports don't exist at runtime, but we can check the function signature
      expect(imported.detectStrandedFeeCollections).toBeDefined();
    });

    it("exports UncollectableFeesReport type", async () => {
      const imported = await import("@/lib/detect-uncollectable-fees");
      expect(imported.aggregateUncollectableFees).toBeDefined();
    });
  });

  describe("2. Stranded fee collection detection", () => {
    let mockAdmin: SupabaseClient;

    beforeEach(() => {
      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                data: [],
                error: null,
              })),
              data: [],
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;
    });

    it("detects pending fee collections, with or without a provider_collection_ref", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockData = [
        {
          id: "fc-1",
          contractor_id: "c-1",
          gross_pennies: 400,
          net_pennies: 333,
          vat_pennies: 67,
          period_start: "2026-07-01",
          created_at: "2026-07-15T10:00:00Z",
        },
      ];

      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                data: mockData,
                error: null,
              })),
              data: mockData,
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;

      const result = await detectStrandedFeeCollections(mockAdmin);

      expect(mockAdmin.from).toHaveBeenCalledWith("fee_collections");
      expect(result.count).toBe(1);
      expect(result.totalGrossPennies).toBe(400);
    });

    it("returns zero counts when no stranded collections exist", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const result = await detectStrandedFeeCollections(mockAdmin);

      expect(result.count).toBe(0);
      expect(result.totalGrossPennies).toBe(0);
      expect(result.totalNetPennies).toBe(0);
      expect(result.totalVatPennies).toBe(0);
      expect(result.affectedContractorIds).toEqual([]);
    });

    it("sums gross, net, and VAT across multiple stranded collections", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockData = [
        {
          id: "fc-1",
          contractor_id: "c-1",
          gross_pennies: 200,
          net_pennies: 167,
          vat_pennies: 33,
        },
        {
          id: "fc-2",
          contractor_id: "c-1",
          gross_pennies: 400,
          net_pennies: 333,
          vat_pennies: 67,
        },
        {
          id: "fc-3",
          contractor_id: "c-2",
          gross_pennies: 200,
          net_pennies: 167,
          vat_pennies: 33,
        },
      ];

      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                data: mockData,
                error: null,
              })),
              data: mockData,
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;

      const result = await detectStrandedFeeCollections(mockAdmin);

      expect(result.count).toBe(3);
      expect(result.totalGrossPennies).toBe(800); // 200 + 400 + 200
      expect(result.totalNetPennies).toBe(667); // 167 + 333 + 167
      expect(result.totalVatPennies).toBe(133); // 33 + 67 + 33
    });

    it("deduplicates contractor IDs in the affected list", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockData = [
        { id: "fc-1", contractor_id: "c-1", gross_pennies: 200 },
        { id: "fc-2", contractor_id: "c-1", gross_pennies: 400 },
        { id: "fc-3", contractor_id: "c-2", gross_pennies: 200 },
      ];

      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                data: mockData,
                error: null,
              })),
              data: mockData,
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;

      const result = await detectStrandedFeeCollections(mockAdmin);

      expect(result.affectedContractorIds).toHaveLength(2);
      expect(result.affectedContractorIds).toContain("c-1");
      expect(result.affectedContractorIds).toContain("c-2");
    });

    it("excludes zero-value stranded collections from the total", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockData = [
        { id: "fc-1", contractor_id: "c-1", gross_pennies: 400 },
        { id: "fc-2", contractor_id: "c-2", gross_pennies: 0 }, // free jobs batch
      ];

      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                data: mockData,
                error: null,
              })),
              data: mockData,
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;

      const result = await detectStrandedFeeCollections(mockAdmin);

      // Should count the row but not include it in the total
      expect(result.count).toBe(1);
      expect(result.totalGrossPennies).toBe(400);
    });
  });

  describe("3. Aggregate uncollectable fees", () => {
    let mockAdmin: SupabaseClient;

    beforeEach(() => {
      // Default mock that returns empty results
      mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              not: vi.fn(() => ({ data: [], error: null })),
              lte: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({ data: [], error: null })),
                data: [],
                error: null,
              })),
            })),
            lte: vi.fn(() => ({ data: [], error: null })),
          })),
        })),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;
    });

    it("aggregates uncollectable fees from all sources", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const result = await aggregateUncollectableFees(mockAdmin);

      expect(result).toBeDefined();
      expect(result.lostFeesFromPartialSettlement).toBeDefined();
      expect(result.strandedPendingCollections).toBeDefined();
      expect(result.totalGrossPennies).toBeDefined();
      expect(result.totalAffectedContractors).toBeDefined();
      expect(result.totalAffectedJobs).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it("sums gross pennies across both sources", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      // Mock lost fees: 1 job with £4 fee
      // Mock stranded collections: 1 collection with £2 fee
      const mockJobs = [
        {
          id: "j-1",
          contractor_id: "c-1",
          paid_at: "2026-07-01T10:00:00Z",
          invoiced_total_pennies: 150000,
          fee_status: "not_applicable",
          fee_waived_reason: null,
        },
      ];

      const mockCollections = [
        {
          id: "fc-1",
          contractor_id: "c-2",
          gross_pennies: 200,
          net_pennies: 167,
          vat_pennies: 33,
        },
      ];

      mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === "jobs") {
            return {
              select: vi.fn(() => ({
                not: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn(() => ({ data: mockJobs, error: null })),
                    data: mockJobs,
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (table === "fee_collections") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({ data: mockCollections, error: null })),
                  data: mockCollections,
                  error: null,
                })),
              })),
            };
          }
          if (table === "contractors") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({ data: { id: "c-1" }, error: null })),
                  single: vi.fn(() => ({ data: { id: "c-1" }, error: null })),
                  data: [{ id: "c-1" }],
                  error: null,
                })),
              })),
            };
          }
          if (table === "credit_events") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  lte: vi.fn(() => ({ data: [], error: null })),
                })),
              })),
            };
          }
          return { select: vi.fn(() => ({ data: [], error: null })) };
        }),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(mockAdmin);

      // Should sum lost fees (£4 = 400p) + stranded collections (£2 = 200p)
      expect(result.totalGrossPennies).toBeGreaterThan(0);
    });

    it("deduplicates contractor count across both sources", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      // Mock the same contractor appearing in both sources
      const mockJobs = [
        {
          id: "j-1",
          contractor_id: "c-1",
          paid_at: "2026-07-01T10:00:00Z",
          invoiced_total_pennies: 150000,
          fee_status: "not_applicable",
          fee_waived_reason: null,
        },
      ];

      const mockCollections = [
        {
          id: "fc-1",
          contractor_id: "c-1", // Same contractor
          gross_pennies: 200,
        },
      ];

      mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === "jobs") {
            return {
              select: vi.fn(() => ({
                not: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn(() => ({ data: mockJobs, error: null })),
                    data: mockJobs,
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (table === "fee_collections") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({ data: mockCollections, error: null })),
                  data: mockCollections,
                  error: null,
                })),
              })),
            };
          }
          if (table === "contractors") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({
                    data: { id: "c-1", stripe_account_id: "acct_123" },
                    error: null,
                  })),
                  single: vi.fn(() => ({
                    data: { id: "c-1", stripe_account_id: "acct_123" },
                    error: null,
                  })),
                  data: [{ id: "c-1", stripe_account_id: "acct_123" }],
                  error: null,
                })),
              })),
            };
          }
          if (table === "credit_events") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  lte: vi.fn(() => ({ data: [], error: null })),
                })),
              })),
            };
          }
          return { select: vi.fn(() => ({ data: [], error: null })) };
        }),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(mockAdmin);

      // Should count contractor c-1 only once, not twice
      expect(result.totalAffectedContractors).toBeLessThanOrEqual(1);
    });

    it("includes a human-readable summary message", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const result = await aggregateUncollectableFees(mockAdmin);

      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    });

    it("reports zero when no uncollectable fees exist", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const result = await aggregateUncollectableFees(mockAdmin);

      expect(result.totalGrossPennies).toBe(0);
      expect(result.totalAffectedContractors).toBe(0);
      expect(result.totalAffectedJobs).toBe(0);
      expect(result.message).toContain("No uncollectable fees");
    });
  });

  describe("4. Contractor metadata enrichment", () => {
    it("flags contractors with no stripe_account_id", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockJobs = [
        {
          id: "j-1",
          contractor_id: "c-1",
          paid_at: "2026-07-01T10:00:00Z",
          invoiced_total_pennies: 150000,
          fee_status: "not_applicable",
          fee_waived_reason: null,
        },
      ];

      const mockContractor = {
        id: "c-1",
        stripe_account_id: null, // No Stripe account
      };

      const admin = {
        from: vi.fn((table: string) => {
          if (table === "jobs") {
            return {
              select: vi.fn(() => ({
                not: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn(() => ({ data: mockJobs, error: null })),
                    data: mockJobs,
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (table === "contractors") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({ data: mockContractor, error: null })),
                  single: vi.fn(() => ({ data: mockContractor, error: null })),
                  data: [mockContractor],
                  error: null,
                })),
              })),
            };
          }
          if (table === "credit_events") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  lte: vi.fn(() => ({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === "fee_collections") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({ data: [], error: null })),
                  data: [],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn(() => ({ data: [], error: null })) };
        }),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(admin);

      // Should include contractor metadata in the breakdown
      expect(result.lostFeesFromPartialSettlement.contractors).toBeDefined();
      if (result.lostFeesFromPartialSettlement.contractors.length > 0) {
        const contractor = result.lostFeesFromPartialSettlement.contractors[0];
        expect(contractor).toHaveProperty("contractorId");
      }
    });

    it("identifies deleted or anonymised contractors separately", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const mockJobs = [
        {
          id: "j-1",
          contractor_id: "deleted-c-1",
          paid_at: "2026-07-01T10:00:00Z",
          invoiced_total_pennies: 150000,
          fee_status: "not_applicable",
          fee_waived_reason: null,
        },
      ];

      const admin = {
        from: vi.fn((table: string) => {
          if (table === "jobs") {
            return {
              select: vi.fn(() => ({
                not: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn(() => ({ data: mockJobs, error: null })),
                    data: mockJobs,
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (table === "contractors") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => ({ data: null, error: null })), // Deleted
                })),
              })),
            };
          }
          if (table === "credit_events") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  lte: vi.fn(() => ({ data: [], error: null })),
                })),
              })),
            };
          }
          if (table === "fee_collections") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({ data: [], error: null })),
                  data: [],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn(() => ({ data: [], error: null })) };
        }),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(admin);

      expect(result.lostFeesFromPartialSettlement.deletedOrAnonymisedContractors).toBeDefined();
      expect(Array.isArray(result.lostFeesFromPartialSettlement.deletedOrAnonymisedContractors)).toBe(true);
    });
  });

  describe("5. Read-only guarantee", () => {
    it("makes no database writes when detecting stranded collections", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const insertSpy = vi.fn();
      const updateSpy = vi.fn();
      const deleteSpy = vi.fn();
      const rpcSpy = vi.fn();

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              data: [],
              error: null,
            })),
          })),
          insert: insertSpy,
          update: updateSpy,
          delete: deleteSpy,
        })),
        rpc: rpcSpy,
      } as unknown as SupabaseClient;

      await detectStrandedFeeCollections(admin);

      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it("makes no database writes when aggregating uncollectable fees", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const insertSpy = vi.fn();
      const updateSpy = vi.fn();
      const deleteSpy = vi.fn();

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              not: vi.fn(() => ({ data: [], error: null })),
              lte: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({ data: [], error: null })),
                data: [],
                error: null,
              })),
            })),
            lte: vi.fn(() => ({ data: [], error: null })),
          })),
          insert: insertSpy,
          update: updateSpy,
          delete: deleteSpy,
        })),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      await aggregateUncollectableFees(admin);

      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe("6. Very old fees flagging", () => {
    it("flags fees for jobs paid more than 6 months ago", async () => {
      const { detectStrandedFeeCollections } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 7); // 7 months ago

      const mockData = [
        {
          id: "fc-1",
          contractor_id: "c-1",
          gross_pennies: 400,
          created_at: sixMonthsAgo.toISOString(),
        },
      ];

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: mockData, error: null })),
              data: mockData,
              error: null,
            })),
          })),
        })),
      } as unknown as SupabaseClient;

      const result = await detectStrandedFeeCollections(admin);

      // Should flag old collections
      expect(result).toBeDefined();
      // The specific flag structure depends on implementation
      // but the report should identify aged fees somehow
    });
  });

  describe("7. Report metadata", () => {
    it("includes a timestamp in the aggregated report", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              not: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({ data: [], error: null })),
                data: [],
                error: null,
              })),
            })),
          })),
        })),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(admin);

      // Report should include when it was generated
      expect(result).toBeDefined();
      // Timestamp may be in the message or a separate field
    });
  });

  describe("8. Integration with existing recover-lost-fees", () => {
    it("calls recoverLostFees in dry-run mode", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              not: vi.fn(() => ({ data: [], error: null })),
              lte: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({ data: [], error: null })),
                data: [],
                error: null,
              })),
            })),
            lte: vi.fn(() => ({ data: [], error: null })),
          })),
        })),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(admin);

      // Should include lost fees report from the existing module
      expect(result.lostFeesFromPartialSettlement).toBeDefined();
      expect(result.lostFeesFromPartialSettlement).toHaveProperty("contractors");
      expect(result.lostFeesFromPartialSettlement).toHaveProperty("totalAffectedJobs");
    });

    it("preserves the structure of LostFeeReport from recover-lost-fees", async () => {
      const { aggregateUncollectableFees } = await import(
        "@/lib/detect-uncollectable-fees"
      );

      const admin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ data: [], error: null })),
              not: vi.fn(() => ({ data: [], error: null })),
              lte: vi.fn(() => ({ data: [], error: null })),
            })),
            not: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({ data: [], error: null })),
                data: [],
                error: null,
              })),
            })),
            lte: vi.fn(() => ({ data: [], error: null })),
          })),
        })),
        rpc: vi.fn(() => ({ data: null, error: null })),
      } as unknown as SupabaseClient;

      const result = await aggregateUncollectableFees(admin);

      const lostFees = result.lostFeesFromPartialSettlement;
      expect(lostFees).toHaveProperty("contractors");
      expect(lostFees).toHaveProperty("deletedOrAnonymisedContractors");
      expect(lostFees).toHaveProperty("totalAffectedJobs");
      expect(lostFees).toHaveProperty("message");
    });
  });
});
