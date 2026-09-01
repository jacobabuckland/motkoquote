/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import {
  actionableError,
  actionableMessage,
  supportDigest,
} from "@/lib/actionable-error";
import {
  ZERO_TOTAL_CONFIRM_REQUIRED,
  narrativeConfirmMessage,
} from "@/lib/quote-send-guards";
import type { LineItem } from "@/lib/schemas/job";
import { sendQuote } from "@/app/jobs/actions";

// A production build redacts the message of anything a Server Action rejects
// with. Every guard in sendQuote asks its question BY throwing, and the editor
// recognised those questions by matching on `err.message` — so on motko.app the
// contractor got React's "the specific message is omitted" notice under Send
// quote instead of the question, with no way forward.
//
// `redacted` reproduces that transport exactly, rather than approximating it:
// React's Flight client builds a fresh Error carrying this fixed sentence
// (`resolveErrorProd`) and then copies the server's digest onto it
// (`streamState.digest = buffer.digest`). Message replaced, digest preserved.

const REACT_PRODUCTION_NOTICE =
  "An error occurred in the Server Components render. The specific message is " +
  "omitted in production builds to avoid leaking sensitive details. A digest " +
  "property is included on this error instance which may provide additional " +
  "details about the nature of the error.";

const redacted = (thrown: Error): Error => {
  const onTheWire = new Error(REACT_PRODUCTION_NOTICE);
  const { digest } = thrown as Error & { digest?: string };
  if (digest !== undefined) {
    (onTheWire as Error & { digest?: string }).digest = digest;
  }
  return onTheWire;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/jobs/actions", () => ({
  updateQuoteLineItems: vi.fn(async (_input?: unknown) => undefined),
  sendQuote: vi.fn(async (_input?: unknown) => undefined),
  redraftJob: vi.fn(async (_input?: unknown) => undefined),
  reportEmptyQuoteDraft: vi.fn(async (_input?: unknown) => undefined),
  setQuotePricingMode: vi.fn(async (_input?: unknown) => undefined),
}));

afterEach(cleanup);

const sendQuoteMock = vi.mocked(sendQuote);

const pricedLine: LineItem = {
  description: "Consumer unit swap",
  category: "labour",
  quantity: 1,
  unit: "day",
  unit_price: 340,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  people: [{ label: "Owner", days: 1, day_rate: 340 }],
};

// The editor needs a name and a contact channel before it will let Send fire —
// the same state the screenshot was in: name, email, address, email ticked.
const renderEditor = () =>
  render(
    <QuoteEditor
      jobId="job-1"
      quoteId="quote-1"
      jobTitle="Consumer unit swap"
      initialLineItems={[pricedLine]}
      contractorFlags={[]}
      vatRegistered={false}
      initialCustomerName="Megan Farrant"
      initialCustomerEmail="megan@example.co.uk"
    />,
  );

const clickSend = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Send quote$/ }));

describe("a guard's question survives production redaction", () => {
  it("asks about a deliberate £0 rather than showing React's notice", async () => {
    sendQuoteMock.mockRejectedValueOnce(
      redacted(actionableError(ZERO_TOTAL_CONFIRM_REQUIRED)),
    );

    renderEditor();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByText(/This quote totals £0\.00\. Send it anyway\?/),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/omitted in production builds/)).toBeNull();
  });

  it("shows both figures when the narrative and the total disagree", async () => {
    sendQuoteMock.mockRejectedValueOnce(
      redacted(actionableError(narrativeConfirmMessage(5000, 287.5))),
    );

    renderEditor();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByText(/This quote gives two different prices/),
      ).toBeTruthy();
    });
    // The point of the question is seeing BOTH numbers, and both ride on the
    // sentinel — the editor never reads the scope narrative and the subtotal
    // here is deliberately not the figure on screen, so finding them proves
    // they came off the server's message rather than out of local state.
    expect(screen.getByText("£5,000.00")).toBeTruthy();
    expect(screen.getByText("£287.50")).toBeTruthy();
  });

  it("opens the reconciliation review with the failing line named", async () => {
    sendQuoteMock.mockRejectedValueOnce(
      redacted(
        actionableError("Unsourced line: Consumer unit swap (£340.00)"),
      ),
    );

    renderEditor();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByText(/This quote needs review before sending/),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(/Unsourced line: Consumer unit swap/),
    ).toBeTruthy();
  });

  it("never shows React's notice for a failure we did not author", async () => {
    // A Supabase error: redacted with a Next-generated digest, and it SHOULD
    // stay redacted. What must not happen is the notice reaching the screen in
    // its place — it tells the contractor nothing and offers no way forward.
    const fromNext = new Error(REACT_PRODUCTION_NOTICE);
    (fromNext as Error & { digest?: string }).digest = "3801277460";
    sendQuoteMock.mockRejectedValueOnce(fromNext);

    renderEditor();
    clickSend();

    await waitFor(() => {
      expect(screen.getByText(/Couldn't send the quote/)).toBeTruthy();
    });
    expect(screen.queryByText(/omitted in production builds/)).toBeNull();
    // The digest is the only handle tying this screen to the server log.
    expect(screen.getByText(/reference 3801277460/)).toBeTruthy();
  });
});

describe("actionableMessage", () => {
  it("recovers an authored message after redaction", () => {
    expect(
      actionableMessage(redacted(actionableError(ZERO_TOTAL_CONFIRM_REQUIRED))),
    ).toBe(ZERO_TOTAL_CONFIRM_REQUIRED);
  });

  it("reads the message directly when nothing redacted it", () => {
    // Development, and every server-side test: sendQuote is called directly and
    // the Error it threw is the Error the caller catches.
    expect(actionableMessage(actionableError("Add your day rate"))).toBe(
      "Add your day rate",
    );
  });

  it("refuses to treat React's notice as an authored message", () => {
    const fromNext = new Error(REACT_PRODUCTION_NOTICE);
    (fromNext as Error & { digest?: string }).digest = "3801277460";

    expect(actionableMessage(fromNext)).toBeNull();
    expect(supportDigest(fromNext)).toBe("3801277460");
  });

  it("keeps an unauthored message off the digest", () => {
    // The digest crosses to the client verbatim, so nothing may be put on it
    // that we did not write. An ordinary throw stays redacted.
    const dbFailure = new Error('duplicate key value violates unique constraint');

    expect(supportDigest(redacted(dbFailure))).toBeNull();
    expect(actionableMessage(redacted(dbFailure))).toBeNull();
  });
});
