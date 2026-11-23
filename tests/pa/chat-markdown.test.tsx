/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ChatMessageView } from "@/lib/pa/service";

const actions = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  proposeSendQuoteFromCard: vi.fn(),
  confirmPendingAction: vi.fn(),
  confirmAssumption: vi.fn(),
  reloadChat: vi.fn(),
}));
vi.mock("@/app/chat/actions", () => actions);

const { ChatClient } = await import("@/app/chat/chat-client");

const THREAD = "11111111-1111-4111-8111-111111111111";

const say = (role: "assistant" | "user", content: string): ChatMessageView => ({
  id: `m-${role}`,
  role,
  content,
  cards: [],
  createdAt: "2026-11-22T10:00:00.000Z",
});

const renderChat = (messages: ChatMessageView[]) =>
  render(<ChatClient initialThreadId={THREAD} initialMessages={messages} attention={[]} />);

beforeEach(() => {
  Object.values(actions).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

describe("assistant bubbles render markdown", () => {
  it("turns **bold** into bold text with no literal asterisks", () => {
    const { container } = renderChat([say("assistant", "Total is **£1,062** today.")]);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("£1,062");
    expect(container.textContent).not.toContain("**");
  });

  it("renders bullet and numbered lists as lists", () => {
    const { container } = renderChat([
      say("assistant", "Still to do:\n- confirm crew\n- confirm materials\n\n1. check the card\n2. tap Send"),
    ]);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders inline code and italics", () => {
    const { container } = renderChat([say("assistant", "Use `Change` or *tap* the chip.")]);
    expect(container.querySelector("code")?.textContent).toBe("Change");
    expect(container.querySelector("em")?.textContent).toBe("tap");
  });

  it("keeps single line breaks and separates paragraphs", () => {
    const { container } = renderChat([say("assistant", "Line one\nLine two\n\nNew paragraph")]);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(screen.getByText("New paragraph")).toBeDefined();
  });

  it("links http(s) addresses safely", () => {
    renderChat([say("assistant", "See [the job](https://motko.app/jobs/1).")]);
    const link = screen.getByRole("link", { name: "the job" });
    expect(link).toHaveAttribute("href", "https://motko.app/jobs/1");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("does not turn a javascript: address into a link", () => {
    renderChat([say("assistant", "[click](javascript:alert(1))")]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows raw HTML as inert text, never as elements", () => {
    const { container } = renderChat([
      say("assistant", "<script>window.__pwned = 1</script><img src=x onerror=alert(1)> hello"),
    ]);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("leaves money and plain text exactly as written", () => {
    const { container } = renderChat([say("assistant", "The tap is £85 each, 2 x 3 = 6")]);
    expect(container.textContent).toContain("The tap is £85 each, 2 x 3 = 6");
  });
});

describe("user bubbles stay plain text", () => {
  it("shows the user's asterisks and backticks literally", () => {
    const { container } = renderChat([say("user", "price it **fixed** with `tap`")]);
    expect(container.textContent).toContain("price it **fixed** with `tap`");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
  });
});
