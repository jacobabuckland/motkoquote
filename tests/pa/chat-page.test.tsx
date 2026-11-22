import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  redirected: null as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  usePathname: () => "/chat",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
      return builder;
    },
  }),
}));

describe("/chat", () => {
  beforeEach(() => {
    h.user = null;
    h.redirected = null;
  });

  it("sends a signed-out visitor to /login", async () => {
    const { default: ChatPage } = await import("@/app/chat/page");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(h.redirected).toBe("/login");
  });

  it("a signed-in user with no contractor profile goes to /setup, like the other app pages", async () => {
    h.user = { id: "user_1" };
    const { default: ChatPage } = await import("@/app/chat/page");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT /setup");
  });
});
