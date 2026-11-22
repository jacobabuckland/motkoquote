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

const haptics = vi.hoisted(() => ({
  tap: vi.fn(),
  press: vi.fn(),
  select: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/haptics", () => haptics);

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
  nextStep: "Check the draft, confirm pricing, crew and materials, then send it.",
  ...overrides,
});

const assistant = (cards: ChatMessageView["cards"], content = "Here's the draft."): ChatMessageView => ({
  id: "m1",
  role: "assistant",
  content,
  cards,
  createdAt: "2026-11-22T10:00:00.000Z",
});

const renderChat = (
  messages: ChatMessageView[],
  attention = [] as Parameters<typeof ChatClient>[0]["attention"],
  owed: number | null = null,
) => render(<ChatClient initialThreadId={THREAD} initialMessages={messages} attention={attention} owed={owed} />);

beforeEach(() => {
  Object.values(actions).forEach((mock) => mock.mockReset());
  Object.values(haptics).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

describe("the chat screen", () => {
  it("shows what is the contractor's move as rows, each linking to its job", () => {
    renderChat([], [
      { jobId: JOB, customer: "Dave Carter", title: "rewire", situation: "draft_quote", why: "Draft quote waiting for you to check and send" },
    ]);
    const section = screen.getByRole("region", { name: "Your move" });
    const link = within(section).getByRole("link", { name: "Dave Carter" });
    expect(link).toHaveAttribute("href", `/jobs/${JOB}`);
    expect(within(section).getByText("Draft quote waiting for you to check and send")).toBeInTheDocument();
  });

  it("each row can be put to Motko in one tap", async () => {
    actions.sendChatMessage.mockResolvedValue({ ok: true, threadId: THREAD, messages: [] });
    renderChat([], [
      { jobId: JOB, customer: "Dave Carter", title: "rewire", situation: "draft_quote", why: "Draft quote waiting for you to check and send" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Ask Motko" }));
    await waitFor(() =>
      expect(actions.sendChatMessage).toHaveBeenCalledWith({ threadId: THREAD, text: "What's next on the Dave Carter job?" }),
    );
  });

  it("shows three rows and offers the rest", () => {
    const item = (n: number) => ({
      jobId: `00000000-0000-4000-8000-00000000000${n}`,
      customer: `Customer ${n}`,
      title: "job",
      situation: "draft_quote" as const,
      why: "Draft quote waiting for you to check and send",
    });
    renderChat([], [1, 2, 3, 4, 5].map(item));
    const section = screen.getByRole("region", { name: "Your move" });
    expect(within(section).getAllByRole("link")).toHaveLength(3);
    fireEvent.click(within(section).getByRole("button", { name: "Show 2 more" }));
    expect(within(section).getAllByRole("link")).toHaveLength(5);
    expect(within(section).getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
  });

  it("has no strip when nothing needs the contractor", () => {
    renderChat([]);
    expect(screen.queryByRole("region", { name: "Your move" })).toBeNull();
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
    expect(screen.getByText("quote Dave")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Motko" })).toHaveValue("");
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
    expect(actions.confirmAssumption).toHaveBeenCalledWith({
      jobId: JOB,
      slot: "crew",
      expectedValue: "Just you",
    });
  });

  it("Change shows what can be changed, and each choice starts the sentence for you", () => {
    renderChat([assistant([quoteCard()])]);
    expect(screen.queryByRole("group", { name: "What would you like to change?" })).toBeNull();

    const change = screen.getByRole("button", { name: "Change" });
    expect(change).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");

    const options = screen.getByRole("group", { name: "What would you like to change?" });
    for (const label of ["Price", "Customer details", "Add a line", "Remove a line"]) {
      expect(within(options).getByRole("button", { name: label })).toBeEnabled();
    }

    fireEvent.click(within(options).getByRole("button", { name: "Customer details" }));
    expect(screen.getByRole("textbox", { name: "Message Motko" })).toHaveValue(
      "On the Dave Carter quote: the customer's email is ",
    );
    // Choosing one closes the list again.
    expect(screen.queryByRole("group", { name: "What would you like to change?" })).toBeNull();
  });

  it("a quote that has gone out says what happens next and links to the job", () => {
    renderChat([
      assistant([
        quoteCard({
          status: "Sent",
          canSend: false,
          blockers: [],
          nextStep: "Waiting for the customer to accept. You'll get a notification when they do.",
        }),
      ]),
    ]);
    expect(screen.getByText(/Waiting for the customer to accept/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job" })).toHaveAttribute("href", `/jobs/${JOB}`);
    // No editing controls on something that has already gone.
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("a draft does not repeat the next step: its buttons and blockers already say it", () => {
    renderChat([assistant([quoteCard()])]);
    expect(screen.queryByRole("link", { name: "Open the job" })).toBeNull();
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
    actions.reloadChat.mockResolvedValue({
      ok: true,
      messages: [{ id: "m3", role: "assistant", content: "Sent to Dave Carter.", cards: [], createdAt: "" }],
    });

    renderChat([assistant([ready])]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const card = await screen.findByTestId("confirm-card");
    expect(actions.proposeSendQuoteFromCard).toHaveBeenCalledWith({ threadId: THREAD, jobId: JOB });
    expect(actions.confirmPendingAction).not.toHaveBeenCalled();

    expect(within(card).getByText("Send the quote to Dave Carter?")).toBeInTheDocument();
    expect(within(card).getByText("£900.00, to dave@example.com.")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Yes, send it" }));
    expect(await screen.findByText("Sent to Dave Carter.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the job" })).toHaveAttribute("href", `/jobs/${JOB}`);
  });

  it("a sent quote offers no Send button", () => {
    renderChat([assistant([quoteCard({ status: "Sent", canSend: false, blockers: ["This quote has already gone out."] })])]);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  const confirmCardWith = (overrides: Partial<ConfirmCard> = {}): ConfirmCard => ({
    type: "confirm",
    pendingActionId: "44444444-4444-4444-8444-444444444444",
    threadId: THREAD,
    action: "send_quote",
    title: "Send the quote to Dave Carter?",
    summary: "£900.00, to dave@example.com.",
    expiresAt: "2026-11-22T10:10:00.000Z",
    confirmLabel: "Yes, send it",
    state: "pending",
    ...overrides,
  });

  it("a refused card says it was not sent, in the words it was refused with, and offers no button", () => {
    renderChat([
      assistant([
        confirmCardWith({
          state: "refused",
          outcomeMessage: "Not sent: the quote or who it's going to changed after you were asked.",
        }),
      ]),
    ]);
    expect(screen.getByText(/Not sent: the quote or who it's going to changed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, send it" })).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("a card whose outcome was never recorded says it can't tell, not Done", () => {
    renderChat([assistant([confirmCardWith({ state: "unknown" })])]);
    expect(screen.getByText(/can't tell whether that went through/)).toBeInTheDocument();
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.queryByRole("button", { name: "Yes, send it" })).toBeNull();
  });

  it("a refused tap shows the error and re-reads the thread, so the spent card can't be tapped again or marked done", async () => {
    actions.confirmPendingAction.mockResolvedValue({
      ok: false,
      error: "Not sent: the quote or who it's going to changed after you were asked.",
    });
    actions.reloadChat.mockResolvedValue({
      ok: true,
      messages: [
        assistant([
          confirmCardWith({ state: "refused", outcomeMessage: "Not sent: the quote or who it's going to changed after you were asked." }),
        ]),
      ],
    });
    renderChat([assistant([confirmCardWith()])]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

    await waitFor(() => expect(actions.reloadChat).toHaveBeenCalledWith({ threadId: THREAD }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Yes, send it" })).toBeNull());
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getAllByText(/Not sent: the quote or who it's going to changed/).length).toBeGreaterThan(0);
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

describe("a server action that rejects never strands the screen", () => {
  it("a failed send puts the words back, shows a calm error and leaves the composer usable", async () => {
    actions.sendChatMessage.mockRejectedValue(new Error("network"));
    renderChat([]);
    const box = screen.getByRole("textbox", { name: "Message Motko" });
    fireEvent.change(box, { target: { value: "quote Dave" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing has been sent");
    expect(box).toHaveValue("quote Dave");
    expect(screen.queryByText("On it…")).toBeNull();
    fireEvent.change(box, { target: { value: "quote Dave again" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("a failed assumption tap shows the error and the chips work again", async () => {
    actions.confirmAssumption.mockRejectedValueOnce(new Error("network"));
    renderChat([assistant([quoteCard()])]);
    fireEvent.click(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing has been sent");
    expect(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ })).toBeEnabled();
  });

  it("a failed Send tap and a failed confirm tap each show the error", async () => {
    const ready = quoteCard({
      assumptions: quoteCard().assumptions.map((a) => ({ ...a, value: a.value ?? "x", confirmed: true })),
      blockers: [],
      canSend: true,
    });
    actions.proposeSendQuoteFromCard.mockRejectedValueOnce(new Error("network"));
    renderChat([assistant([ready])]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing has been sent");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    cleanup();

    const confirm: ConfirmCard = {
      type: "confirm", pendingActionId: "44444444-4444-4444-8444-444444444444", threadId: THREAD,
      action: "send_quote", title: "Send the quote?", summary: "£900.00", expiresAt: "", confirmLabel: "Yes, send it", state: "pending",
    };
    actions.confirmPendingAction.mockRejectedValueOnce(new Error("network"));
    renderChat([assistant([confirm])]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing has been sent");
    await waitFor(() => expect(screen.getByRole("button", { name: "Yes, send it" })).toBeEnabled());
  });

  it("when the value moved, the refused tap refreshes the card and says so", async () => {
    const moved = quoteCard({
      assumptions: quoteCard().assumptions.map((a) => (a.slot === "crew" ? { ...a, value: "2 people" } : a)),
    });
    actions.confirmAssumption.mockResolvedValue({ ok: false, error: "That changed since you last looked. Check it again.", card: moved });
    renderChat([assistant([quoteCard()])]);
    fireEvent.click(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That changed");
    expect(screen.getByRole("button", { name: /Crew: 2 people\. Tap to confirm/ })).toBeEnabled();
  });
});

describe("the ledger figure at the head of the thread", () => {
  it("shows what is owed in the display face, and a tap asks who owes it", async () => {
    actions.sendChatMessage.mockResolvedValue({ ok: true, threadId: THREAD, messages: [] });
    renderChat([], [], 1840);
    const strip = screen.getByRole("button", { name: /£1,840\.00 owed to you/ });
    // The Money Rule: an amount is set in the display face, never body type.
    expect(within(strip).getByText("£1,840.00")).toHaveClass("display");
    fireEvent.click(strip);
    await waitFor(() =>
      expect(actions.sendChatMessage).toHaveBeenCalledWith({ threadId: THREAD, text: "Who owes me money?" }),
    );
  });

  it("says you're all square when nothing is owed", () => {
    renderChat([], [], 0);
    expect(screen.getByRole("button", { name: /You're all square/ })).toBeInTheDocument();
  });

  it("is left out entirely when the figure could not be read", () => {
    renderChat([], [], null);
    expect(screen.queryByRole("button", { name: /owed to you|all square/ })).toBeNull();
  });
});

describe("an empty conversation is an invitation", () => {
  it("offers starters: one prefills, two send straight away", async () => {
    actions.sendChatMessage.mockResolvedValue({ ok: true, threadId: THREAD, messages: [] });
    renderChat([]);
    expect(screen.getByText("What's on today?")).toBeInTheDocument();
    expect(screen.getByText(/Nothing goes to a customer until you tap/)).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "Things to try" });
    fireEvent.click(within(group).getByRole("button", { name: "Quote a job" }));
    expect(screen.getByRole("textbox", { name: "Message Motko" })).toHaveValue("Quote ");
    expect(actions.sendChatMessage).not.toHaveBeenCalled();

    fireEvent.click(within(group).getByRole("button", { name: "What needs me?" }));
    await waitFor(() =>
      expect(actions.sendChatMessage).toHaveBeenCalledWith({ threadId: THREAD, text: "What needs me?" }),
    );
  });

  it("is gone once there is a conversation", () => {
    renderChat([assistant([], "Morning.")]);
    expect(screen.queryByText("What's on today?")).toBeNull();
  });
});

describe("Motko's words are light and the objects are heavy", () => {
  it("every amount on a quote card is set in the display face", () => {
    renderChat([assistant([quoteCard()])]);
    const card = screen.getByTestId("quote-card");
    // The line amount and the total both. This used to be a plain span.
    for (const amount of within(card).getAllByText("£900.00")) {
      expect(amount).toHaveClass("display");
    }
    expect(within(card).getAllByText("£900.00").length).toBeGreaterThanOrEqual(2);
  });

  it("a draft carries the amber keyline and a quote that has gone out does not", () => {
    const { unmount } = renderChat([assistant([quoteCard()])]);
    expect(screen.getByTestId("quote-card")).toHaveClass("keyline-move");
    unmount();
    renderChat([assistant([quoteCard({ status: "Sent", canSend: false, blockers: [] })])]);
    expect(screen.getByTestId("quote-card")).not.toHaveClass("keyline-move");
  });

  it("a confirm card shows the amount as money, who it goes to, and that nothing happens until the tap", () => {
    const confirm: ConfirmCard = {
      type: "confirm",
      pendingActionId: "44444444-4444-4444-8444-444444444444",
      threadId: THREAD,
      action: "send_quote",
      title: "Send the quote to Dave Carter?",
      summary: "£900.00, to dave@example.com.",
      amount: 900,
      recipient: "dave@example.com",
      vatIncluded: false,
      expiresAt: "2026-11-22T10:10:00.000Z",
      confirmLabel: "Yes, send it",
      state: "pending",
    };
    renderChat([assistant([confirm])]);
    const card = screen.getByTestId("confirm-card");
    expect(within(card).getByText("£900.00")).toHaveClass("display");
    expect(within(card).getByText("To dave@example.com")).toBeInTheDocument();
    expect(within(card).getByText("Nothing happens until you tap.")).toBeInTheDocument();
    expect(card).toHaveClass("keyline-move");
    // The old sentence is not repeated when the figures are shown.
    expect(within(card).queryByText("£900.00, to dave@example.com.")).toBeNull();
  });
});

describe("motion happens when something changes, not when history loads", () => {
  it("a tick is drawn only for an assumption confirmed during this visit", async () => {
    const confirmed = quoteCard({
      assumptions: quoteCard().assumptions.map((a) => (a.slot === "crew" ? { ...a, confirmed: true } : a)),
    });
    actions.confirmAssumption.mockResolvedValue({ ok: true, card: confirmed });
    const { container } = renderChat([assistant([quoteCard()])]);
    // Pricing was already confirmed on load: its tick is there, and still.
    // (The tick is the path drawn with a dash; the composer's icons are not.)
    expect(container.querySelectorAll('path[stroke-dasharray="100"]').length).toBe(1);
    expect(container.querySelectorAll(".check-draw-animation").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ }));
    await waitFor(() => expect(container.querySelectorAll(".check-draw-animation").length).toBe(1));
  });

  it("messages already in the thread do not animate; one that arrives does", async () => {
    actions.sendChatMessage.mockResolvedValue({
      ok: true,
      threadId: THREAD,
      messages: [
        { id: "u2", role: "user", content: "quote Dave", cards: [], createdAt: "2026-11-22T11:00:00.000Z" },
        { id: "a2", role: "assistant", content: "On it.", cards: [], createdAt: "2026-11-22T11:00:01.000Z" },
      ],
    });
    renderChat([assistant([], "Morning.")]);
    expect(screen.getByText("Morning.").parentElement).not.toHaveClass("animate-ledger");

    fireEvent.change(screen.getByRole("textbox", { name: "Message Motko" }), { target: { value: "quote Dave" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const reply = await screen.findByText("On it.");
    expect(reply.parentElement).toHaveClass("animate-ledger");
    expect(screen.getByText("Morning.").parentElement).not.toHaveClass("animate-ledger");
  });
});

describe("it works while it works, and says so", () => {
  it("shows a working line only while a message is being answered", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.sendChatMessage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderChat([]);
    expect(screen.queryByText("On it…")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Message Motko" }), { target: { value: "quote Dave" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("On it…")).toBeInTheDocument();

    finish({ ok: true, threadId: THREAD, messages: [] });
    await waitFor(() => expect(screen.queryByText("On it…")).toBeNull());
  });
});

describe("the phone is told what happened", () => {
  it("taps on send, selects on a chip, and reports a failed send", async () => {
    actions.confirmAssumption.mockResolvedValue({ ok: true, card: quoteCard() });
    actions.sendChatMessage.mockResolvedValue({ ok: false, error: "Nope." });
    renderChat([assistant([quoteCard()])]);

    fireEvent.click(screen.getByRole("button", { name: /Crew: Just you\. Tap to confirm/ }));
    expect(haptics.select).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Message Motko" }), { target: { value: "quote Dave" } });
    // The chip's request keeps the screen busy until it resolves, and Send waits.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(haptics.tap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(haptics.error).toHaveBeenCalledTimes(1));
  });

  it("a successful confirm is a success, a refused one is an error", async () => {
    const confirm: ConfirmCard = {
      type: "confirm",
      pendingActionId: "44444444-4444-4444-8444-444444444444",
      threadId: THREAD,
      action: "send_quote",
      title: "Send?",
      summary: "£900.00",
      expiresAt: "2026-11-22T10:10:00.000Z",
      confirmLabel: "Yes, send it",
      state: "pending",
    };
    actions.confirmPendingAction.mockResolvedValueOnce({ ok: true, messages: [] });
    actions.reloadChat.mockResolvedValue({ ok: true, messages: [assistant([{ ...confirm, state: "done" }])] });
    const { unmount } = renderChat([assistant([confirm])]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
    await waitFor(() => expect(haptics.success).toHaveBeenCalledTimes(1));
    unmount();

    actions.confirmPendingAction.mockResolvedValueOnce({ ok: false, error: "Not sent." });
    renderChat([assistant([confirm])]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
    await waitFor(() => expect(haptics.error).toHaveBeenCalledTimes(1));
  });
});

describe("a tap is felt exactly once", () => {
  it("pressing Return taps once, and the Send button taps once (its own, not doubled)", async () => {
    actions.sendChatMessage.mockResolvedValue({ ok: true, threadId: THREAD, messages: [] });
    renderChat([]);
    const box = screen.getByRole("textbox", { name: "Message Motko" });

    fireEvent.change(box, { target: { value: "quote Dave" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(actions.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(haptics.tap).toHaveBeenCalledTimes(1);

    haptics.tap.mockClear();
    fireEvent.change(box, { target: { value: "quote Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(actions.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it("the ledger figure taps once", async () => {
    actions.sendChatMessage.mockResolvedValue({ ok: true, threadId: THREAD, messages: [] });
    renderChat([], [], 500);
    fireEvent.click(screen.getByRole("button", { name: /owed to you/ }));
    await waitFor(() => expect(actions.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });
});

describe("the thread keeps its days", () => {
  it("labels a message from yesterday and one from today", async () => {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    renderChat([
      { id: "m1", role: "user", content: "quote Dave", cards: [], createdAt: at(1) },
      { id: "m2", role: "assistant", content: "Drafted.", cards: [], createdAt: at(1) },
      { id: "m3", role: "user", content: "send it", cards: [], createdAt: at(0) },
    ]);
    // Labels appear once the client knows what day it is, not on the server.
    expect(await screen.findByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
