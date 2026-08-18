/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GuestQuote } from "@/lib/guest/quote";
import type { GuestArtefact } from "@/lib/guest/session";
import type { LineItem } from "@/lib/schemas/job";

afterEach(cleanup);

// The defect this file exists for could only be found on a device: tapping
// Share threw, and the recovery text pointed at a control that did not exist.
//
// The cause was that the tap handler awaited the PDF render before calling
// navigator.share(). iOS grants a tap a transient activation window and rejects
// share() outside it, so by the time the call happened it was already too late.
// The property that fixes it is testable here without a device: share() must be
// invoked SYNCHRONOUSLY inside the click, with nothing awaited first.

const line: LineItem = {
  description: "Full rewire — three-bed semi",
  category: "labour",
  quantity: 5,
  unit: "day",
  unit_price: 340,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

const quote: GuestQuote = {
  reference: "ABCD1234",
  createdAt: "2026-03-14T09:30:00.000Z",
  jobType: "Full rewire",
  lineItems: [line],
  subtotal: 1700,
  total: 1700,
  customer: null,
  contractorFlags: [],
  unpricedLabour: false,
};

const artefact: GuestArtefact = {
  version: 1,
  reference: "ABCD1234",
  createdAt: "2026-03-14T09:30:00.000Z",
  updatedAt: "2026-03-14T09:30:00.000Z",
  sow: null,
  transcript: [],
  quote,
};

// Resolves on the next macrotask, standing in for the real renderer's dynamic
// imports plus layout pass. Anything the handler awaits would be at least this
// slow on a phone — which is the whole point.
const renderPdfBlob = vi.fn(
  async (): Promise<Blob> =>
    new Promise((resolve) => {
      setTimeout(() => resolve(new Blob(["%PDF-1.7"], { type: "application/pdf" })), 0);
    }),
);

vi.mock("@/lib/guest/session", () => ({
  readGuestArtefact: () => artefact,
}));

vi.mock("@/lib/guest/pdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/guest/pdf")>();
  return { ...original, renderGuestQuotePdfBlob: renderPdfBlob };
});

type ShareArg = { files?: File[]; title?: string };

const share = vi.fn<(data: ShareArg) => Promise<void>>(async () => {});
const canShare = vi.fn<(data: ShareArg) => boolean>(() => true);

const stubNavigator = () => {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, "canShare", {
    value: canShare,
    configurable: true,
    writable: true,
  });
};

const mountQuoteScreen = async () => {
  const { default: GuestQuotePage } = await import("@/app/start/quote/page");
  render(<GuestQuotePage />);
  // The document renders on mount, not on tap. The control is disabled until
  // it exists, which is precisely what removes any reason to await in the
  // handler.
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /Share the PDF/ }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  return screen.getByRole("button", { name: /Share the PDF/ }) as HTMLButtonElement;
};

describe("sharing a guest quote PDF", () => {
  beforeEach(() => {
    share.mockClear();
    canShare.mockClear();
    renderPdfBlob.mockClear();
    share.mockImplementation(async () => {});
    canShare.mockImplementation(() => true);
    stubNavigator();
    URL.createObjectURL = vi.fn(() => "blob:motko/quote");
    URL.revokeObjectURL = vi.fn();
  });

  it("calls navigator.share within the tap itself, awaiting nothing first", async () => {
    const button = await mountQuoteScreen();

    fireEvent.click(button);

    // Deliberately NOT awaited. fireEvent.click runs the React handler
    // synchronously, so if share() has not been called by the time control
    // returns here, the handler suspended on an await first — and on iOS the
    // activation window would be gone by the time it resumed.
    expect(share, "navigator.share was not called inside the tap").toHaveBeenCalledTimes(1);

    const [data] = share.mock.calls[0] ?? [];
    expect(data?.files?.[0]?.type).toBe("application/pdf");
    expect(data?.files?.[0]?.name).toBe("quote-ABCD1234.pdf");
  });

  it("renders the document once, on mount — never again on tap", async () => {
    const button = await mountQuoteScreen();
    expect(renderPdfBlob).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalled());

    // A second render is not merely wasteful: it is the work that used to
    // happen inside the gesture and cost the activation.
    expect(renderPdfBlob).toHaveBeenCalledTimes(1);
  });

  it("keeps a way out on screen at all times, not only after a failure", async () => {
    await mountQuoteScreen();

    // Present before anything is tapped, and not fallback content buried
    // inside <object> — WKWebView can paint an empty PDF box without ever
    // showing fallback, which is how the old advice became a dead end.
    const open = screen.getByRole("link", { name: "Open the PDF" });
    expect(open.getAttribute("href")).toBe("blob:motko/quote");
    expect(open.getAttribute("download")).toBe("quote-ABCD1234.pdf");
  });

  it("never tells the user to open the PDF from the preview", async () => {
    await mountQuoteScreen();
    expect(document.body.textContent).not.toMatch(/from the preview above/i);
  });

  it("points at the real control when the platform cannot share files", async () => {
    canShare.mockImplementation(() => false);
    const button = await mountQuoteScreen();

    fireEvent.click(button);

    expect(share, "share was attempted despite canShare saying no").not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/can't share files directly/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Open the PDF" })).toBeTruthy();
  });

  it("treats a dismissed share sheet as a cancellation, not a failure", async () => {
    share.mockImplementation(async () => {
      throw new DOMException("share canceled", "AbortError");
    });
    const button = await mountQuoteScreen();

    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalled());

    expect(screen.queryByText(/Couldn't open the share sheet/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Share the PDF" })).toBeTruthy();
  });

  it("reports a genuine share failure by naming the control that still works", async () => {
    share.mockImplementation(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    const button = await mountQuoteScreen();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/Use Open the PDF above/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Open the PDF" })).toBeTruthy();
  });

  it("settles on a terminal label once the share completes", async () => {
    const button = await mountQuoteScreen();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("button", { name: "Shared ✓" })).toBeTruthy());
  });
});
