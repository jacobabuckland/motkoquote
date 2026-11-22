import { beforeEach, describe, expect, it, vi } from "vitest";

// The figure at the head of the thread. The money position holds PENCE; the page
// must hand the screen POUNDS. A unit test on the helper cannot catch the page
// forgetting to use it, which is how £1,840 once showed as £184,000.
const h = vi.hoisted(() => ({
  position: { owedToYou: [] as { customerName: string; totalOwed: number }[] },
  failPosition: false,
  props: null as null | { owed: number | null },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  usePathname: () => "/chat",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/require-contractor", () => ({
  requireContractor: async () => ({ id: "c1", company_name: "Sparks Ltd", vat_registered: false }),
}));
vi.mock("@/lib/pa/anthropic-client", () => ({ createAnthropicClient: () => ({ complete: vi.fn() }) }));
vi.mock("@/lib/pa/real-actions", () => ({
  realActions: {
    getMoneyPosition: async () => {
      if (h.failPosition) throw new Error("db down");
      return { ...h.position, whatsLeft: 0, safeToSpend: { total: 0, collected: 0 }, projection: { total: 0, owedNet: 0 } };
    },
  },
}));
vi.mock("@/lib/pa/needs-attention", () => ({ loadNeedsAttention: async () => [] }));
vi.mock("@/lib/pa/service", () => ({
  loadLatestThreadId: async () => null,
  loadThread: async () => [],
}));
vi.mock("@/components/ui/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/app/chat/chat-client", () => ({
  ChatClient: (props: { owed: number | null }) => {
    h.props = props;
    return null;
  },
}));

describe("/chat owed figure", () => {
  beforeEach(() => {
    h.failPosition = false;
    h.props = null;
  });

  const render = async () => {
    const { default: ChatPage } = await import("@/app/chat/page");
    const element = await ChatPage();
    // Invoke the client stub so it records its props.
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
      if (typeof n.type === "function") (n.type as (p: unknown) => unknown)(n.props);
      const children = n.props?.children;
      if (Array.isArray(children)) children.forEach(walk);
      else walk(children);
    };
    walk(element);
  };

  it("shows £1,840 for 184,000 pence, not £184,000", async () => {
    h.position = { owedToYou: [{ customerName: "Dave", totalOwed: 150000 }, { customerName: "Amy", totalOwed: 34000 }] };
    await render();
    expect(h.props?.owed).toBe(1840);
  });

  it("leaves the figure out, rather than failing the page, when it cannot be read", async () => {
    h.failPosition = true;
    await render();
    expect(h.props?.owed).toBeNull();
  });
});
