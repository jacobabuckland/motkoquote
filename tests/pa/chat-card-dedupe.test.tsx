/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ChatMessageView } from "@/lib/pa/service";
import type { QuoteCard } from "@/lib/pa/types";

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
const JOB_A = "22222222-2222-4222-8222-222222222222";
const JOB_B = "44444444-4444-4444-8444-444444444444";

const card = (jobId: string, total: number, overrides: Partial<QuoteCard> = {}): QuoteCard => ({
  type: "quote",
  jobId,
  quoteId: "33333333-3333-4333-8333-333333333333",
  customerName: jobId === JOB_A ? "Dave Carter" : "Priya Shah",
  title: "rewire",
  status: "Draft",
  lines: [{ description: "Kitchen rewire, labour", quantity: 3, unit: "day", amount: total }],
  moreLines: 0,
  subtotal: total,
  vat: 0,
  total,
  vatRegistered: false,
  assumptions: [
    { slot: "pricing_mode", label: "Pricing", value: "Worked out from your rates", confirmed: true },
    { slot: "crew", label: "Crew", value: "Just you", confirmed: true },
    { slot: "materials_supply", label: "Materials", value: "You supply", confirmed: true },
  ],
  blockers: [],
  canSend: true,
  recipient: "Dave Carter, dave@example.com",
  ...overrides,
});

const message = (id: string, cards: ChatMessageView["cards"]): ChatMessageView => ({
  id,
  role: "assistant",
  content: `reply ${id}`,
  cards,
  createdAt: "2026-11-22T10:00:00.000Z",
});

const renderChat = (messages: ChatMessageView[]) =>
  render(<ChatClient initialThreadId={THREAD} initialMessages={messages} attention={[]} />);

beforeEach(() => {
  Object.values(actions).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

describe("one live card per quote", () => {
  it("renders exactly one Send and one Change for a quote shown four times", () => {
    renderChat([
      message("m1", [card(JOB_A, 900)]),
      message("m2", [card(JOB_A, 960)]),
      message("m3", [card(JOB_A, 1000)]),
      message("m4", [card(JOB_A, 1062)]),
    ]);
    expect(screen.getAllByRole("button", { name: "Send" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Change" })).toHaveLength(1);
    expect(screen.getAllByTestId("quote-card")).toHaveLength(1);
  });

  it("the live card is the latest one, with the latest total", () => {
    renderChat([message("m1", [card(JOB_A, 960)]), message("m2", [card(JOB_A, 1062)])]);
    expect(screen.getByTestId("quote-card-total").textContent).toContain("1,062");
  });

  it("collapses each earlier event to a one-line summary that has no buttons of its own", () => {
    renderChat([
      message("m1", [card(JOB_A, 900)]),
      message("m2", [card(JOB_A, 960)]),
      message("m3", [card(JOB_A, 1062)]),
    ]);
    const summaries = screen.getAllByTestId("quote-card-summary");
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.textContent).toContain("£900");
    expect(summaries[1]!.textContent).toContain("£960");
    for (const summary of summaries) {
      expect(summary.querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("keeps one live card for each different quote", () => {
    renderChat([
      message("m1", [card(JOB_A, 900)]),
      message("m2", [card(JOB_B, 500)]),
      message("m3", [card(JOB_A, 1062)]),
    ]);
    expect(screen.getAllByTestId("quote-card")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Send" })).toHaveLength(2);
    expect(screen.getAllByTestId("quote-card-summary")).toHaveLength(1);
  });

  it("two cards for the same quote in one message also collapse to one live card", () => {
    renderChat([message("m1", [card(JOB_A, 900), card(JOB_A, 1062)])]);
    expect(screen.getAllByTestId("quote-card")).toHaveLength(1);
    expect(screen.getAllByTestId("quote-card-summary")).toHaveLength(1);
  });

  it("leaves a lone quote card exactly as it was", () => {
    renderChat([message("m1", [card(JOB_A, 900)])]);
    expect(screen.getAllByTestId("quote-card")).toHaveLength(1);
    expect(screen.queryByTestId("quote-card-summary")).toBeNull();
  });
});
