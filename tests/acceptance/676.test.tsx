/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

// Required: Testing Library's automatic cleanup doesn't register without globals: true
afterEach(cleanup);

describe("676: Address & postcode lookup at capture", () => {
  describe("getAddress.io API client", () => {
    beforeEach(() => {
      vi.resetModules();
      delete (global as { fetch?: unknown }).fetch;
    });

    it("exports loadGetAddressLibrary that returns the client when API key is present", async () => {
      const mod = await import("@/lib/getaddress");
      expect(mod.loadGetAddressLibrary).toBeDefined();

      // Mock the env var
      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-api-key-12345");

      const client = await mod.loadGetAddressLibrary();
      expect(client).not.toBeNull();
      expect(client).toHaveProperty("autocomplete");
      expect(client).toHaveProperty("get");
    });

    it("returns null when no API key is present", async () => {
      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "");

      const mod = await import("@/lib/getaddress");
      const client = await mod.loadGetAddressLibrary();
      expect(client).toBeNull();
    });

    it("autocomplete fetches suggestions from getAddress.io with the API key", async () => {
      const mockSuggestions = [
        { id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" },
        { id: "addr_2", address: "11 Downing Street, London, SW1A 2AB" },
      ];

      global.fetch = vi.fn(async (url) => {
        expect(url).toContain("api.getaddress.io");
        expect(url).toContain("autocomplete");
        expect(url).toContain("api-key=test-key");
        return {
          ok: true,
          json: async () => ({ suggestions: mockSuggestions }),
        } as Response;
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const mod = await import("@/lib/getaddress");
      const client = await mod.loadGetAddressLibrary();
      expect(client).not.toBeNull();

      const results = await client!.autocomplete("SW1A");
      expect(results).toEqual(mockSuggestions);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("get fetches full address details from getAddress.io", async () => {
      const mockAddress = {
        line_1: "10 Downing Street",
        line_2: "",
        line_3: "",
        town_or_city: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        latitude: 51.5034,
        longitude: -0.1276,
      };

      global.fetch = vi.fn(async (url) => {
        expect(url).toContain("api.getaddress.io");
        expect(url).toContain("get/addr_1");
        expect(url).toContain("api-key=test-key");
        return {
          ok: true,
          json: async () => mockAddress,
        } as Response;
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const mod = await import("@/lib/getaddress");
      const client = await mod.loadGetAddressLibrary();
      expect(client).not.toBeNull();

      const address = await client!.get("addr_1");
      expect(address).toEqual(mockAddress);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("autocomplete returns empty array on fetch failure", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const mod = await import("@/lib/getaddress");
      const client = await mod.loadGetAddressLibrary();

      const results = await client!.autocomplete("SW1A");
      expect(results).toEqual([]);
    });

    it("get returns null on fetch failure", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const mod = await import("@/lib/getaddress");
      const client = await mod.loadGetAddressLibrary();

      const address = await client!.get("addr_1");
      expect(address).toBeNull();
    });

    it("exports addressToStructuredAddress that maps getAddress.io format to StructuredAddress", async () => {
      const mod = await import("@/lib/getaddress");
      expect(mod.addressToStructuredAddress).toBeDefined();

      const getAddressResponse = {
        line_1: "10 Downing Street",
        line_2: "Westminster",
        line_3: "",
        town_or_city: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        latitude: 51.5034,
        longitude: -0.1276,
      };

      const structured = mod.addressToStructuredAddress(getAddressResponse);

      expect(structured.formatted).toBe(
        "10 Downing Street, Westminster, London, Greater London, SW1A 2AA",
      );
      expect(structured.line1).toBe("10 Downing Street");
      expect(structured.line2).toBe("Westminster");
      expect(structured.town).toBe("London");
      expect(structured.county).toBe("Greater London");
      expect(structured.postcode).toBe("SW1A 2AA");
      expect(structured.lat).toBe(51.5034);
      expect(structured.lng).toBe(-0.1276);
    });

    it("addressToStructuredAddress omits empty line2 and line3", async () => {
      const mod = await import("@/lib/getaddress");

      const getAddressResponse = {
        line_1: "10 Downing Street",
        line_2: "",
        line_3: "",
        town_or_city: "London",
        county: "",
        postcode: "SW1A 2AA",
        latitude: 51.5034,
        longitude: -0.1276,
      };

      const structured = mod.addressToStructuredAddress(getAddressResponse);

      expect(structured.line2).toBeUndefined();
      expect(structured.county).toBeUndefined();
    });

    it("addressToStructuredAddress omits coordinates when missing", async () => {
      const mod = await import("@/lib/getaddress");

      const getAddressResponse = {
        line_1: "10 Downing Street",
        line_2: "",
        line_3: "",
        town_or_city: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        latitude: 0,
        longitude: 0,
      };

      const structured = mod.addressToStructuredAddress(getAddressResponse);

      expect(structured.lat).toBeUndefined();
      expect(structured.lng).toBeUndefined();
    });
  });

  describe("AddressAutocomplete component", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
      delete (global as { fetch?: unknown }).fetch;
    });

    it("renders a text input with the given label", async () => {
      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      expect(screen.getByLabelText("Site address")).toBeDefined();
      expect(screen.getByRole("combobox")).toBeDefined();
    });

    it("calls onChange with raw address object on every keystroke", async () => {
      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "10 Downing" } });

      expect(onChange).toHaveBeenCalledWith({ formatted: "10 Downing" });
    });

    it("does not fetch suggestions until at least 3 characters are typed", async () => {
      global.fetch = vi.fn();
      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;

      fireEvent.change(input, { target: { value: "SW" } });
      await waitFor(() => expect(global.fetch).not.toHaveBeenCalled(), { timeout: 500 });

      fireEvent.change(input, { target: { value: "SW1" } });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled(), { timeout: 500 });
    });

    it("shows dropdown with suggestions when fetch succeeds", async () => {
      const mockSuggestions = [
        { id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" },
        { id: "addr_2", address: "11 Downing Street, London, SW1A 2AB" },
      ];

      global.fetch = vi.fn(async (url) => {
        if ((url as string).includes("autocomplete")) {
          return {
            ok: true,
            json: async () => ({ suggestions: mockSuggestions }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "SW1A" } });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      expect(screen.getByText("10 Downing Street, London, SW1A 2AA")).toBeDefined();
      expect(screen.getByText("11 Downing Street, London, SW1A 2AB")).toBeDefined();
    });

    it("selecting a suggestion fetches full details and calls onChange with structured address", async () => {
      const mockSuggestions = [
        { id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" },
      ];

      const mockFullAddress = {
        line_1: "10 Downing Street",
        line_2: "",
        line_3: "",
        town_or_city: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        latitude: 51.5034,
        longitude: -0.1276,
      };

      global.fetch = vi.fn(async (url) => {
        if ((url as string).includes("autocomplete")) {
          return {
            ok: true,
            json: async () => ({ suggestions: mockSuggestions }),
          } as Response;
        }
        if ((url as string).includes("get/addr_1")) {
          return {
            ok: true,
            json: async () => mockFullAddress,
          } as Response;
        }
        return { ok: false } as Response;
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "SW1A" } });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      const suggestion = screen.getByText("10 Downing Street, London, SW1A 2AA");
      fireEvent.mouseDown(suggestion);

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            formatted: "10 Downing Street, London, Greater London, SW1A 2AA",
            line1: "10 Downing Street",
            town: "London",
            county: "Greater London",
            postcode: "SW1A 2AA",
            lat: 51.5034,
            lng: -0.1276,
          }),
        );
      });
    });

    it("degrades to plain text field when no API key is present", async () => {
      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "");
      global.fetch = vi.fn();

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "123 Main Street" } });

      // Wait to ensure no fetch was attempted
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith({ formatted: "123 Main Street" });
    });

    it("continues as plain text field when fetch fails", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      });

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "SW1A" } });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Should not show a dropdown
      expect(screen.queryByRole("listbox")).toBeNull();

      // Free text should still flow through
      expect(onChange).toHaveBeenCalledWith({ formatted: "SW1A" });
    });

    it("closes dropdown when clicking outside", async () => {
      const mockSuggestions = [
        { id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" },
      ];

      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ suggestions: mockSuggestions }),
      })) as unknown as typeof fetch;

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(
        <div>
          <AddressAutocomplete label="Site address" value="" onChange={onChange} />
          <button>Outside</button>
        </div>,
      );

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "SW1A" } });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      const outsideButton = screen.getByRole("button", { name: "Outside" });
      fireEvent.pointerDown(outsideButton);

      await waitFor(() => {
        expect(screen.queryByRole("listbox")).toBeNull();
      });
    });

    it("supports keyboard navigation with arrow keys", async () => {
      const mockSuggestions = [
        { id: "addr_1", address: "10 Downing Street, London, SW1A 2AA" },
        { id: "addr_2", address: "11 Downing Street, London, SW1A 2AB" },
      ];

      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ suggestions: mockSuggestions }),
      })) as unknown as typeof fetch;

      vi.stubEnv("NEXT_PUBLIC_ADDRESS_LOOKUP", "test-key");

      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(<AddressAutocomplete label="Site address" value="" onChange={onChange} />);

      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "SW1A" } });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Arrow down should highlight first option
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const firstOption = screen.getByText("10 Downing Street, London, SW1A 2AA").closest("li");
      expect(firstOption?.getAttribute("aria-selected")).toBe("true");

      // Arrow down again should highlight second option
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const secondOption = screen.getByText("11 Downing Street, London, SW1A 2AB").closest("li");
      expect(secondOption?.getAttribute("aria-selected")).toBe("true");

      // Arrow up should go back to first
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(firstOption?.getAttribute("aria-selected")).toBe("true");
    });

    it("shows error message when error prop is provided", async () => {
      const onChange = vi.fn();
      const { AddressAutocomplete } = await import("@/components/ui/address-autocomplete");

      render(
        <AddressAutocomplete
          label="Site address"
          value=""
          onChange={onChange}
          error="Address is required"
        />,
      );

      expect(screen.getByText("Address is required")).toBeDefined();
    });
  });

  describe("Integration with existing forms", () => {
    it("setup form imports and uses AddressAutocomplete", async () => {
      const mod = await import("@/app/setup/setup-form");
      expect(mod.default).toBeDefined();
    });

    it("create contract form imports and uses AddressAutocomplete", async () => {
      const mod = await import("@/app/dashboard/create-contract-form");
      expect(mod.default).toBeDefined();
    });
  });

  // RETIRED — "google-maps.ts removal" / "google-maps module no longer exists".
  //
  // It asserted `import("@/lib/google-maps")` rejects. tests/acceptance/106.test.ts
  // imports `placeToStructuredAddress` and `PlaceResult` from that path and
  // exercises them in 11 tests, so the two contracts were mutually exclusive and
  // both files are frozen. Retired by Jacob's decision of 8 Sep in favour of
  // keeping #106, whose subject (normalizeUkPostcode) #676 does not touch.
  //
  // Nothing #676 asked for is lost. The getAddress.io lookup is built and covered
  // above; src/lib/google-maps.ts is reduced to the two pure exports #106 needs,
  // with no Maps API client, key or network call left in it.
});
