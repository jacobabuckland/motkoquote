/**
 * @vitest-environment happy-dom
 *
 * `/jobs/<id>/sow` on a phone, 21 Sep: "the page renders a large empty bordered
 * rectangle — no spinner, no skeleton, no 'loading', just a blank outline with
 * 'Open the PDF full screen' beneath it", through a 3-second and then a
 * 5-second wait before the PDF appeared.
 *
 * `loading.tsx` covers the SERVER component resolving, which is fast. The wait
 * that matters starts after it, when the embed fetches /api/jobs/[id]/sow-pdf —
 * four sequential round trips and a renderToBuffer, cached nowhere. An object's
 * children show only when the resource CANNOT be displayed, never while it is
 * on its way, so there was nothing in it.
 *
 * AND IT IS NOT BLANK. Reproduced in Chromium at 420x860 against a PDF held for
 * eight seconds: it paints a solid dark panel, Chrome's PDF viewer with no
 * document in it — which is the same report's "the main pane renders black",
 * not a second fault.
 *
 * The embed is therefore mounted only once the bytes are in hand. Laying a
 * skeleton OVER it was measured and does not work: a live PDF embed owns its
 * rectangle in the compositing tree, and the overlay painted nothing at
 * z-index 10, and nothing again with the object at opacity 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { SowDocument } from "@/app/jobs/[id]/sow/sow-document";

const HREF = "/api/jobs/job_1/sow-pdf";

/** Resolves when the test says so, so the "still loading" window is enterable. */
const deferredPdf = () => {
  let settle!: (ok: boolean) => void;
  const done = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  // Parameter declared and OPTIONAL: a zero-argument mock makes
  // `mock.calls[0][0]` unreachable (TS2493), and one with a required parameter
  // makes a no-argument call a type error. See AGENTS.md — #403 and #438 lost a
  // cycle each to the two halves of this.
  const fetchMock = vi.fn(async (_input?: RequestInfo | URL) => {
    const ok = await done;
    return {
      ok,
      status: ok ? 200 : 500,
      blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    } as unknown as Response;
  });
  return { fetchMock, arrive: () => settle(true), fail: () => settle(false) };
};

let revoked: string[] = [];

beforeEach(() => {
  revoked = [];
  // happy-dom has no object-URL store of its own worth relying on.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:sow-1"),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const embed = () => document.querySelector<HTMLObjectElement>('object[type="application/pdf"]');

describe("while the document is on its way", () => {
  it("says so, rather than showing an empty frame", () => {
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);

    expect(screen.getByText("Preparing this document…")).toBeTruthy();
  });

  it("does not mount the embed yet", () => {
    // The load-bearing claim. A PDF embed owns its rectangle in the
    // compositing tree, so anything laid over it is invisible — measured. The
    // only arrangement that shows a loading state is not having the embed on
    // screen during the wait.
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);

    expect(embed()).toBeNull();
  });

  it("announces the wait to a screen reader", () => {
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);

    expect(screen.getByTestId("sow-loading").getAttribute("aria-live")).toBe("polite");
  });

  it("asks the route for the document exactly once", () => {
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(HREF);
  });
});

describe("when it arrives", () => {
  it("shows the document and takes the loading state down", async () => {
    const { fetchMock, arrive } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);
    expect(screen.getByTestId("sow-loading")).toBeTruthy();

    await act(async () => {
      arrive();
    });

    await waitFor(() => expect(embed()).toBeTruthy());
    expect(screen.queryByTestId("sow-loading")).toBeNull();
    expect(embed()?.getAttribute("data")).toBe("blob:sow-1");
  });

  it("keeps the fallback for a device that cannot show a PDF inline", async () => {
    const { fetchMock, arrive } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);
    await act(async () => {
      arrive();
    });
    await waitFor(() => expect(embed()).toBeTruthy());

    expect(screen.getByText("This device can't show the PDF inline.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the statement of work" }).getAttribute("href"),
    ).toBe(HREF);
  });

  it("releases the blob when the page is left", async () => {
    const { fetchMock, arrive } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<SowDocument pdfHref={HREF} />);
    await act(async () => {
      arrive();
    });
    await waitFor(() => expect(embed()).toBeTruthy());

    view.unmount();

    expect(revoked).toEqual(["blob:sow-1"]);
  });
});

describe("when it does not arrive", () => {
  // Deterministic, so there is nothing to wait FOR. Advance the clock and
  // assert synchronously — `waitFor` polls on the timers the fake clock has
  // frozen and would deadlock. See AGENTS.md.
  it("stops claiming everything is normal, and offers the way out", () => {
    vi.useFakeTimers();
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);
    expect(screen.getByText("Preparing this document…")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    expect(screen.getByText("Still preparing this document…")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open it full screen instead" })).toBeTruthy();

    vi.useRealTimers();
  });

  it("does not offer it before there is anything wrong", () => {
    vi.useFakeTimers();
    const { fetchMock } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.queryByText(/Still preparing/)).toBeNull();

    vi.useRealTimers();
  });
});

describe("when the route refuses", () => {
  it("says the document could not be loaded, rather than waiting forever", async () => {
    // There was no failure path at all. A 401, 404 or 500 left the same dark
    // panel indefinitely, with nothing to tell a slow render from a dead one.
    const { fetchMock, fail } = deferredPdf();
    vi.stubGlobal("fetch", fetchMock);

    render(<SowDocument pdfHref={HREF} />);
    await act(async () => {
      fail();
    });

    await waitFor(() =>
      expect(screen.getByText("Couldn't load the statement of work.")).toBeTruthy(),
    );
    expect(
      screen.getByRole("link", { name: "Try opening it full screen" }).getAttribute("href"),
    ).toBe(HREF);
    expect(embed()).toBeNull();
  });

  it("says the same when the request itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    render(<SowDocument pdfHref={HREF} />);

    await waitFor(() =>
      expect(screen.getByText("Couldn't load the statement of work.")).toBeTruthy(),
    );
  });
});
