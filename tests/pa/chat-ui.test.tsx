/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatMessageView } from "@/lib/pa/service";
import type { ConfirmCard, QuoteCard } from "@/lib/pa/types";

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
const JOB = "22222222-2222-4222-8222-222222222222";

const quoteCard = (overrides: Partial<QuoteCard> = {}): QuoteCard => ({
  type: "quote",
  jobId: JOB,
  quoteId: "33333333-3333-4333-8333-333333333333",
  customerName: "Dave Carter",
  title: "rewire",
  status: "Draft",
  lines: [{ description: "Kitchen rewire, labour", quantity: 3, unit: "day", amount: 900 }],
  moreLines: 0,
  subtotal: 900,
  vat: 0,
  total: 900,
  vatRegistered: false,
  assumptions: [
    { slot: "pricing_mode", label: "Pricing", value: "Worked out from your rates", confirmed: true },
    { slot: "crew", label: "Crew", value: "Just you", confirmed: false },
    { slot: "materials_supply", label: "Materials", value: null, confirmed: false },
  ],
  blockers: ["Confirm the crew, materials before it can go."],
  canSend: false,
  recipient: "Dave Carter, dave@example.com",
  ...overrides,
});

const assistant = (cards: ChatMessageView["cards"], content = "Here's the draft."): ChatMessageView => ({
  id: "m1",
  role: "assistant",
  content,
  cards,
  createdAt: "2026-11-22T10:00:00.000Z",
});

const renderChat = (messages: ChatMessageView[], attention = [] as Parameters<typeof ChatClient>[0]["attention"]) =>
  render(<ChatClient initialThreadId={THREAD} initialMessages={messages} attention={attention} />);

beforeEach(() => {
  Object.values(actions).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

describe("the chat screen", () => {
  it("shows the needs-you strip with each item linking to its job", () => {
    renderChat([], [
      { jobId: JOB, customer: "Dave Carter", title: "rewire", situation: "draft_quote", why: "Draft quote waiting for you to check and send" },
    ]);
    const strip = screen.getByRole("region", { name: "Needs you" });
    const link = within(strip).getByRole("link", { name: /Dave Carter: rewire/ });
    expect(link).toHaveAttribute("href", `/jobs/${JOB}`);
  });

  it("has no strip when nothing needs the contractor", () => {
    renderChat([]);
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
  });

  it("has a composer, and a mic button that is present but disabled and says why", () => {
    renderChat([]);
    expect(screen.getByRole("textbox", { name: "Message Motko" })).toBeInTheDocument();
    const mic = screen.getByRole("button", { name: "Voice is coming soon" });
    expect(mic).toBeDisabled();
  });

  it("sends a typed message and shows the reply and its card", async () => {
    actions.sendChatMessage.mockResolvedValue({
      ok: true,
      threadId: THREAD,
      messages: [
        { id: "u1", role: "user", content: "quote Dave", cards: [], createdAt: "" },
        assistant([quoteCard()]),
      ],
    });
    renderChat([]);
    fireEvent.change(screen.getByRole("textbox", { name: "Message Motko" }), {
      target: { value: "quote Dave" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByTestId("quote-card")).toBeInTheDocument();
    expect(actions.sendChatMessage).toHaveBeenCalledWith({ threadId: THREAD, text: "quote Dave" });
    expect(screen.getByText("Here's the draft.")).toBeInTheDocument();
  });
});

describe("the quote card", () => {
  it("shows the total from the card, and all three assumptions", () => {
    renderChat([assistant([quoteCard()])]);
    expect(screen.getByTestId("quote-card-total")).toHaveTextContent("£900.00");
    const group = screen.getByRole("group", { name: "What this quote assumes" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: /Crew: Just you\. Tap to confirm/ })).toBeEnabled();
    expect(within(group).getByRole("button", { name: /Pricing: .*Confirmed/ })).toBeDisabled();
  });

  it("keeps Send disabled while anything is unconfirmed, and lists why", () => {
    renderChat([assistant([quoteCard()])]);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/Confirm the crew, materials/)).toBeInTheDocument();
  });

  it("confirms an assumption on tap and updates the card", async () => {
    const confirmed = quoteCard({
      assumptions: quoteCard().assumptions.map((a) => (a.slot === "crew" ? { ...a, confirmed: true } : a)),
    });
    actions.confirmAssumption.mockResolvedValue({ ok: true, card: confirmed });
    renderChat([assistant([quoteCard()])]);
    fireEvent.click(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Crew: Just you\. Confirmed/ })).toBeDisabled(),
    );
    expect(actions.confirmAssumption).toHaveBeenCalledWith({ jobId: JOB, slot: "crew" });
  });

  it("a slot that was never stated asks rather than confirms: it prefills the composer", () => {
    renderChat([assistant([quoteCard()])]);
    fireEvent.click(screen.getByRole("button", { name: /Materials: not set/ }));
    expect(actions.confirmAssumption).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Message Motko" })).toHaveValue(
      "For materials: I'm supplying them / the customer is supplying them.",
    );
  });

  it("Send on a ready card proposes; it does not send. The confirm card is what sends.", async () => {
    const ready = quoteCard({
      assumptions: quoteCard().assumptions.map((a) => ({ ...a, value: a.value ?? "You supply the materials", confirmed: true })),
      blockers: [],
      canSend: true,
    });
    const confirm: ConfirmCard = {
      type: "confirm",
      pendingActionId: "44444444-4444-4444-8444-444444444444",
      threadId: THREAD,
      action: "send_quote",
      title: "Send the quote to Dave Carter?",
      summary: "£900.00, to dave@example.com.",
      expiresAt: "2026-11-22T10:10:00.000Z",
      confirmLabel: "Yes, send it",
      state: "pending",
    };
    actions.proposeSendQuoteFromCard.mockResolvedValue({
      ok: true,
      messages: [{ id: "m2", role: "assistant", content: "Check the details, then confirm.", cards: [confirm], createdAt: "" }],
    });
    actions.confirmPendingAction.mockResolvedValue({
      ok: true,
      messages: [{ id: "m3", role: "assistant", content: "Sent to Dave Carter.", cards: [], createdAt: "", link: `/jobs/${JOB}` }],
    });
    actions.reloadChat.mockResolvedValue({ ok: true, messages: [] });

    renderChat([assistant([ready])]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const card = await screen.findByTestId("confirm-card");
    expect(actions.proposeSendQuoteFromCard).toHaveBeenCalledWith({ threadId: THREAD, jobId: JOB });
    expect(actions.confirmPendingAction).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "Yes, send it" }));
    await waitFor(() =>
      expect(actions.confirmPendingAction).toHaveBeenCalledWith({
        threadId: THREAD,
        pendingId: confirm.pendingActionId,
      }),
    );
  });

  it("a sent quote offers no Send button", () => {
    renderChat([assistant([quoteCard({ status: "Sent", canSend: false, blockers: ["This quote has already gone out."] })])]);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("an expired confirm card has no button left to press", () => {
    const expired: ConfirmCard = {
      type: "confirm",
      pendingActionId: "44444444-4444-4444-8444-444444444444",
      threadId: THREAD,
      action: "send_quote",
      title: "Send the quote?",
      summary: "£900.00",
      expiresAt: "",
      confirmLabel: "Yes, send it",
      state: "expired",
    };
    renderChat([assistant([expired])]);
    expect(screen.queryByRole("button", { name: "Yes, send it" })).toBeNull();
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
  });
});
