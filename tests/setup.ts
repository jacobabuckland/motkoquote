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
          "single",
          "order",
          "limit",
          "ilike",
          "or",
          "filter",
        ];

        // Each method returns the chain for further chaining
        for (const method of methods) {
          if (method === "single") {
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
        },
        from: vi.fn((table: string) => {
          if (table === "contractors") {
            return createQueryChain({
              data: mockContractor,
              error: mockContractor ? null : { message: "Not found" },
            });
          }
          if (table === "jobs" && (hasBearerToken || isDirectCall)) {
            // Return mock jobs data for authenticated test requests or direct calls
            // Use "Smith" as customer name to match edge case tests
            return createQueryChain({
              data: [
                {
                  id: "test-job-1",
                  description: "Test job",
                  customer: { name: "Smith" },
                  created_at: new Date().toISOString(),
                },
              ],
              error: null,
            });
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
