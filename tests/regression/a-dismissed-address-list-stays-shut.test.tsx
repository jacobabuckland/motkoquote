/**
 * @vitest-environment happy-dom
 */

/**
 * A suggestion list the user has dismissed does not reopen itself.
 *
 * `fetchSuggestions` guarded against a slow response by comparing the QUERY
 * STRING it was issued for against the latest one:
 *
 *   if (latestQueryRef.current !== input) return;
 *
 * That catches a response overtaken by more typing. It does not catch a
 * response overtaken by the user CLICKING AWAY — the query has not changed, so
 * the guard passes and `setOpen(true)` reopens a list that was deliberately
 * dismissed a moment earlier.
 *
 * `tests/acceptance/676.test.tsx` asserts the list closes on an outside click,
 * and it failed on CI on a docs-only pull request: under load the mocked fetch
 * resolved after the pointerdown instead of before it. It passes locally every
 * time, which is exactly why it is worth pinning the ordering explicitly
 * rather than leaving the contract to whichever order the machine happens to
 * produce.
 *
 * This test holds the response open until after the click, so the race runs in
 * the losing order every time.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

const SUGGESTIONS = [{ id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" }];

describe("a dismissed address list stays shut", () => {
  it("ignores a response that lands after the user clicked away", async () => {
    // Held open deliberately: the request is ISSUED first, then dismissed,
    // then released — the order CI hit and a local run does not.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await held;
      return { ok: true, json: async () => ({ suggestions: SUGGESTIONS }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

    const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

    render(
      <div>
        <AddressAutocomplete label="Site address" value="" onChange={vi.fn()} />
        <button>Outside</button>
      </div>,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "SW1A" } });

    // The lookup is now in flight and still held, so the list cannot be open.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    release?.();

    // Give the resolved response every chance to reopen the list.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.queryByRole("listbox"),
      "the user dismissed this list before the response arrived",
    ).toBeNull();
  });

  it("does not issue a lookup at all when dismissed inside the debounce window", async () => {
    // The click can also land before the request is even made. There is then
    // no in-flight response to disown, so the pending lookup itself has to go
    // — otherwise the list opens under the cursor a moment later.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ suggestions: SUGGESTIONS }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

    const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

    render(
      <div>
        <AddressAutocomplete label="Site address" value="" onChange={vi.fn()} />
        <button>Outside</button>
      </div>,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "SW1A" } });
    // Immediately — inside the debounce, before any request goes out.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(fetchMock, "nobody is waiting for this answer").not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("still opens the list when nobody has dismissed it", async () => {
    // The guard must not be so eager that an ordinary lookup stops working.
    // Nailing the dropdown shut would satisfy the test above and nothing else.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ suggestions: SUGGESTIONS }),
    })) as unknown as typeof fetch;

    vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

    const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

    render(<AddressAutocomplete label="Site address" value="" onChange={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "SW1A" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeDefined();
    });
  });
});
