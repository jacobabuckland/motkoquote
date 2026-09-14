// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import jest-dom matchers for @testing-library assertions
import "@testing-library/jest-dom/vitest";

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";

// Mock Supabase server client for tests that call API routes directly.
// This allows acceptance tests to authenticate via Bearer tokens without
// embedding test bypass logic in production route code.
import { vi } from "vitest";

// Mock Next.js cache functions for server actions that call revalidatePath.
// Without this, server actions fail in tests with "Invariant: static generation
// store missing in revalidatePath".
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Mock Next.js router for tests that render components using useRouter.
// Individual tests can override this mock with their own if needed.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock toast hook for tests that render components outside a ToastProvider.
// This allows page component tests to render without providing toast context,
// while tests that actually use ToastProvider get the real implementation.
vi.mock("@/components/ui/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/toast")>();
  return {
    ...actual,
    useToast: () => {
      // Try to use the real implementation if there's a provider
      try {
        const realUseToast = actual.useToast;
        return realUseToast();
      } catch {
        // No provider, return a mock
        return vi.fn();
      }
    },
  };
});

// Mock OpenAI Realtime client secret creation for tests
vi.mock("@/lib/realtime", () => ({
  createRealtimeClientSecret: vi.fn(async () => "test-realtime-token"),
}));

// Mock Claude drafting functions for the one test that genuinely drafts
vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return {
    ...actual,
    generateSowNarrative: vi.fn(async () => "Test narrative"),
    draftQuoteLineItems: vi.fn(async () => ({
      line_items: [
        {
          category: "labour" as const,
          description: "Test line item",
          quantity: 1,
          unit: "day",
          unit_price: 100,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ],
      tendencies: {},
    })),
  };
});

// Mock Supabase admin client for tests. Returns null for all queries unless
// overridden by a per-test mock (like the golden render tests do).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/server")>(
    "@/lib/supabase/server"
  );

  return {
    ...actual,
    createClient: vi.fn(async () => {
      // In tests, check if there's a request context with a Bearer token.
      // The request is stored in AsyncLocalStorage by the route handler.
      // Import the context storage from the route module.
      let testRequest: Request | undefined;
      try {
        const { requestContext } = await import(
          "@/app/api/ledger/query-session/route"
        );
        testRequest = requestContext.getStore();
      } catch {
        // If route module not available or no context, testRequest stays undefined
      }

      const authHeader = testRequest?.headers.get("Authorization");
      const hasBearerToken = authHeader?.startsWith("Bearer ");

      // If there's no request context, we're being called directly (not through a route).
      // Provide test data to allow unit tests of server actions.
      const isDirectCall = !testRequest;

      // Mock authenticated user if Bearer token present or direct call
      const mockUser =
        hasBearerToken || isDirectCall
          ? { id: "test-user-id", email: "test@example.com" }
          : null;

      // Mock contractor lookup
      const mockContractor =
        hasBearerToken || isDirectCall
          ? { id: "test-contractor-id", owner_user_id: "test-user-id" }
          : null;

      // Create a chainable query builder mock
      const createQueryChain = (finalResult: unknown) => {
        const chain: Record<string, unknown> = {};
        const methods = [
          "select",
          "eq",
          "in",
          "single",
          "maybeSingle",
          "order",
          "limit",
          "ilike",
          "or",
          "filter",
          "insert",
          "upsert",
          "update",
          "delete",
        ];

        // Each method returns the chain for further chaining
        for (const method of methods) {
          if (method === "single" || method === "maybeSingle") {
            chain[method] = vi.fn(async () => finalResult);
          } else {
            chain[method] = vi.fn(() => chain);
          }
        }

        // Terminal methods that execute the query
        chain.then = vi.fn(async (resolve: (value: unknown) => unknown) =>
          resolve(finalResult)
        );

        return chain;
      };

      return {
        auth: {
          getUser: vi.fn(async () => ({ data: { user: mockUser } })),
          updateUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
        },
        from: vi.fn((table: string) => {
          if (table === "contractors") {
            return createQueryChain({
              data: mockContractor,
              error: mockContractor ? null : { message: "Not found" },
            });
          }
          if (table === "jobs" && (hasBearerToken || isDirectCall)) {
            // #726: Return specific job rows for the repair test scenarios
            const jobData: Record<string, unknown> = {
              test_job_with_gaps: {
                id: "test_job_with_gaps",
                description: "Test job with gaps",
                customer: { name: "Test Customer" },
                status: "drafted",
                contractor_id: "test-contractor-id",
                sow_json: {
                  job_type: "Electrical work",
                  customer_name: "Test Customer",
                  site_address: "123 Test St",
                  rooms: [
                    {
                      name: "Living room",
                      dimensions: undefined,
                      work_items: ["Install sockets"],
                    },
                  ],
                  materials_mentioned: [],
                  access_issues: undefined,
                  existing_conditions: undefined,
                  timeline: undefined,
                  labour_plan: null,
                  deadline: null,
                  materials_supply: null,
                  agreed_costs: null,
                  pricing: null,
                  inclusions: [],
                  exclusions: [],
                  additional_items: [],
                  assumptions_and_unknowns: [],
                  customer_phone: undefined,
                  customer_email: undefined,
                  complete: false,
                  next_question: undefined,
                  overview_narrative: undefined,
                  reclassification_count: 0,
                  used_generic_fallback: false,
                  wrap_incomplete: true,
                  unasked_required: ["crew"],
                  stated_prices: [],
                  declined_slots: [],
                  cap_ended: false,
                },
                created_at: new Date().toISOString(),
              },
              job_with_incomplete_quote: {
                id: "job_with_incomplete_quote",
                description: "Job with incomplete quote",
                customer: { name: "Test Customer" },
                status: "drafted",
                contractor_id: "test-contractor-id",
                sow_json: {
                  job_type: "Electrical work",
                  customer_name: "Test Customer",
                  site_address: "123 Test St",
                  rooms: [
                    {
                      name: "Living room",
                      dimensions: undefined,
                      work_items: ["Replace consumer unit"],
                    },
                  ],
                  materials_mentioned: [],
                  access_issues: undefined,
                  existing_conditions: undefined,
                  timeline: undefined,
                  labour_plan: null,
                  deadline: null,
                  materials_supply: null,
                  agreed_costs: null,
                  pricing: null,
                  inclusions: [],
                  exclusions: [],
                  additional_items: [],
                  assumptions_and_unknowns: [],
                  customer_phone: undefined,
                  customer_email: undefined,
                  complete: false,
                  next_question: undefined,
                  overview_narrative: undefined,
                  reclassification_count: 0,
                  used_generic_fallback: false,
                  wrap_incomplete: true,
                  unasked_required: ["crew", "materials_supply"],
                  stated_prices: [],
                  declined_slots: [],
                  cap_ended: false,
                },
                created_at: new Date().toISOString(),
              },
              job_with_accepted_quote: {
                id: "job_with_accepted_quote",
                description: "Job with accepted quote",
                customer: { name: "Test Customer" },
                status: "drafted",
                contractor_id: "test-contractor-id",
                sow_json: {
                  job_type: "Plumbing",
                  customer_name: "Test Customer",
                  site_address: "456 Test Ave",
                  rooms: [
                    {
                      name: "Bathroom",
                      dimensions: undefined,
                      work_items: ["Install boiler"],
                    },
                  ],
                  materials_mentioned: [],
                  access_issues: undefined,
                  existing_conditions: undefined,
                  timeline: undefined,
                  labour_plan: null,
                  deadline: null,
                  materials_supply: null,
                  agreed_costs: null,
                  pricing: { mode: "fixed", fixed_amount: 2500 },
                  inclusions: [],
                  exclusions: [],
                  additional_items: [],
                  assumptions_and_unknowns: [],
                  customer_phone: undefined,
                  customer_email: undefined,
                  complete: false,
                  next_question: undefined,
                  overview_narrative: undefined,
                  reclassification_count: 0,
                  used_generic_fallback: false,
                  wrap_incomplete: true,
                  unasked_required: ["crew", "working_dates", "customer_contact"],
                  stated_prices: [],
                  declined_slots: [],
                  cap_ended: false,
                },
                created_at: new Date().toISOString(),
              },
              job_needing_repair: {
                id: "job_needing_repair",
                description: "Job needing repair",
                customer: { name: "Pat Brown" },
                status: "drafted",
                contractor_id: "test-contractor-id",
                sow_json: {
                  job_type: "Bathroom",
                  customer_name: "Pat Brown",
                  site_address: "789 Oak Lane",
                  rooms: [
                    {
                      name: "Main bathroom",
                      dimensions: undefined,
                      work_items: ["Install suite"],
                    },
                  ],
                  materials_mentioned: [],
                  access_issues: undefined,
                  existing_conditions: undefined,
                  timeline: undefined,
                  labour_plan: null,
                  deadline: null,
                  materials_supply: null,
                  agreed_costs: null,
                  pricing: { mode: "fixed", fixed_amount: 3500 },
                  inclusions: [],
                  exclusions: [],
                  additional_items: [],
                  assumptions_and_unknowns: [],
                  customer_phone: undefined,
                  customer_email: undefined,
                  complete: false,
                  next_question: undefined,
                  overview_narrative: undefined,
                  reclassification_count: 0,
                  used_generic_fallback: false,
                  wrap_incomplete: true,
                  unasked_required: ["crew", "materials_supply", "working_dates"],
                  stated_prices: [],
                  declined_slots: [],
                  cap_ended: false,
                },
                created_at: new Date().toISOString(),
              },
            };

            // Create a custom chain that captures filters for #726 tests
            let jobIdFilter: string | null = null;
            let contractorIdFilter: string | null = null;
            const chain: Record<string, unknown> = {};

            chain.select = vi.fn(() => chain);
            chain.eq = vi.fn((field: string, value: string) => {
              if (field === "id") {
                jobIdFilter = value;
              } else if (field === "contractor_id") {
                contractorIdFilter = value;
              } else if (field === "status") {
                // For status filters, just return chain
              }
              return chain;
            });
            chain.order = vi.fn(() => chain);
            chain.limit = vi.fn(() => chain);
            chain.single = vi.fn(async () => {
              // For .single() queries, check both filters if both were set
              if (jobIdFilter && jobData[jobIdFilter]) {
                const job = jobData[jobIdFilter] as { contractor_id?: string };
                // If contractor_id was filtered, check it matches
                if (contractorIdFilter && job.contractor_id !== contractorIdFilter) {
                  return { data: null, error: { message: "Not found" } };
                }
                return { data: job, error: null };
              }
              return { data: null, error: { message: "Not found" } };
            });
            chain.maybeSingle = vi.fn(async () => {
              const data = jobIdFilter && jobData[jobIdFilter] ? jobData[jobIdFilter] : null;
              return { data, error: null };
            });
            chain.insert = vi.fn(() => chain);
            chain.update = vi.fn(() => chain);
            chain.then = vi.fn(async (resolve: (value: unknown) => unknown) => {
              // For array queries (no specific ID), return the default test job
              const defaultData = [
                {
                  id: "test-job-1",
                  description: "Test job",
                  customer: { name: "Smith" },
                  created_at: new Date().toISOString(),
                },
              ];
              return resolve({ data: defaultData, error: null });
            });

            return chain;
          }
          if (table === "team_members") {
            // Return empty team for #726 tests
            return createQueryChain({ data: [], error: null });
          }
          if (table === "quotes") {
            // #726: Return specific quote rows for the three repair test scenarios
            // Map by both job_id (for reads) and quote id (for updates)
            const quotesByJobId: Record<string, unknown> = {
              job_with_incomplete_quote: {
                id: "quote_incomplete",
                status: "draft",
                line_items_json: [],
                drafted_line_items_json: [],
                contractor_flags_json: null,
                total: 0,
              },
              job_with_accepted_quote: {
                id: "quote_accepted",
                status: "accepted",
                line_items_json: [],
                drafted_line_items_json: [],
                contractor_flags_json: null,
                total: 1000,
              },
              job_needing_repair: {
                id: "quote_needing_repair",
                status: "draft",
                line_items_json: [
                  {
                    category: "labour",
                    description: "Replace consumer unit",
                    quantity: 1,
                    unit: "day",
                    unit_price: 500,
                    multiplier: 1,
                    people_count: 1,
                    overtime: false,
                    assumed: false,
                    edited: true,
                  },
                ],
                drafted_line_items_json: [],
                contractor_flags_json: null,
                total: 500,
              },
            };

            const quotesById: Record<string, unknown> = {
              quote_incomplete: quotesByJobId.job_with_incomplete_quote,
              quote_accepted: quotesByJobId.job_with_accepted_quote,
              quote_needing_repair: quotesByJobId.job_needing_repair,
            };

            // Create a custom chain that captures both .eq("job_id", ...) and .eq("id", ...)
            let jobIdFilter: string | null = null;
            let quoteIdFilter: string | null = null;
            const chain: Record<string, unknown> = {};

            chain.select = vi.fn(() => chain);
            chain.eq = vi.fn((field: string, value: string) => {
              if (field === "job_id") {
                jobIdFilter = value;
              } else if (field === "id") {
                quoteIdFilter = value;
              }
              return chain;
            });
            chain.in = vi.fn(() => chain);
            chain.maybeSingle = vi.fn(async () => {
              const data = jobIdFilter && quotesByJobId[jobIdFilter] ? quotesByJobId[jobIdFilter] : null;
              return { data, error: null };
            });
            chain.single = vi.fn(async () => {
              // For updates, use quote id; for reads, use job id
              let data = null;
              if (quoteIdFilter && quotesById[quoteIdFilter]) {
                data = quotesById[quoteIdFilter];
              } else if (jobIdFilter && quotesByJobId[jobIdFilter]) {
                data = quotesByJobId[jobIdFilter];
              }
              return { data, error: data ? null : { message: "Not found" } };
            });
            chain.insert = vi.fn(() => chain);
            chain.update = vi.fn(() => chain);
            chain.then = vi.fn(async (resolve: (value: unknown) => unknown) =>
              resolve({ data: null, error: null })
            );

            return chain;
          }
          // Return empty result for other tables/unauthenticated
          return createQueryChain({ data: null, error: null });
        }),
      };
    }),
  };
});

// Load globals.css into happy-dom environment for tests that need keyframes/tokens
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll } from "vitest";

beforeAll(() => {
  // Only inject CSS in happy-dom environment (browser-like tests)
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    try {
      const cssPath = join(process.cwd(), "src/app/globals.css");
      let css = readFileSync(cssPath, "utf-8");

      // Remove @import directives that happy-dom can't process
      // These would be resolved by the build tool in production
      css = css.replace(/@import\s+[^;]+;/g, "");

      // Create and inject a style element with the CSS
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);

      // Happy-dom has limited CSS animation support. Patch getComputedStyle to
      // properly extract animationName from the animation shorthand property.
      const originalGetComputedStyle = window.getComputedStyle;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).getComputedStyle = function (
        element: Element,
        pseudoElt?: string | null
      ): CSSStyleDeclaration {
        const computed = originalGetComputedStyle.call(
          this,
          element,
          pseudoElt
        );

        // Create a proxy that preserves the CSSStyleDeclaration instance
        return new Proxy(computed, {
          get(target, prop, receiver) {
            if (prop === "animationName") {
              // Extract animation name from the animation or animationName property
              const elem = element as HTMLElement | SVGElement;
              const animationProp = elem.style.animation || "";
              const animationNameProp = elem.style.animationName || "";

              // Parse animation shorthand (format: "name duration timing-function delay ...")
              if (animationProp) {
                const parts = animationProp.trim().split(/\s+/);
                if (parts.length > 0 && !parts[0].match(/^\d/)) {
                  // First part is the name if it doesn't start with a number
                  return parts[0];
                }
              }

              // Fall back to animationName property
              if (animationNameProp) {
                return animationNameProp;
              }

              // Fall back to the target's value
              return Reflect.get(target, prop, receiver);
            }

            // For all other properties and methods, use Reflect to preserve binding
            const value = Reflect.get(target, prop, receiver);

            // Bind functions to the original target to preserve 'this' context
            if (typeof value === "function") {
              return value.bind(target);
            }

            return value;
          },
        });
      };
    } catch {
      // Silently fail if CSS can't be loaded (e.g., in node environment)
      // Tests that need CSS will fail explicitly if it's missing
    }
  }
});
