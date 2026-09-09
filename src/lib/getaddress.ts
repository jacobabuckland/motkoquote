import type { StructuredAddress } from "@/lib/schemas/address";
import { normalizeUkPostcode } from "@/lib/normalize-postcode";

// getAddress.io API types
type GetAddressAutocompleteSuggestion = {
  id: string;
  address: string;
};

type GetAddressAutocompleteResponse = {
  suggestions: GetAddressAutocompleteSuggestion[];
};

type GetAddressFullAddress = {
  line_1: string;
  line_2: string;
  line_3: string;
  town_or_city: string;
  county: string;
  postcode: string;
  latitude: number;
  longitude: number;
};

type GetAddressClient = {
  autocomplete: (query: string) => Promise<GetAddressAutocompleteSuggestion[]>;
  get: (id: string) => Promise<GetAddressFullAddress | null>;
};

// Loads the getAddress.io client with the API key from environment variables.
// Returns null if no API key is present, allowing graceful degradation to plain text.
export const loadGetAddressLibrary = async (): Promise<GetAddressClient | null> => {
  if (typeof window === "undefined") return null;

  // NEXT_PUBLIC_ prefix is load-bearing, not decoration: this runs in the browser
  // (see the window guard above) and Next.js inlines only NEXT_PUBLIC_* into the
  // client bundle. An unprefixed ADDRESS_LOOKUP reads as undefined here and the
  // field degrades silently to plain text — no error, no Sentry event, no lookup.
  const apiKey = process.env.NEXT_PUBLIC_ADDRESS_LOOKUP;
  if (!apiKey) return null;

  return {
    autocomplete: async (query: string): Promise<GetAddressAutocompleteSuggestion[]> => {
      try {
        const url = `https://api.getaddress.io/autocomplete/${encodeURIComponent(query)}?api-key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url);

        if (!response.ok) {
          return [];
        }

        const data = (await response.json()) as GetAddressAutocompleteResponse;
        return data.suggestions ?? [];
      } catch {
        return [];
      }
    },

    get: async (id: string): Promise<GetAddressFullAddress | null> => {
      try {
        const url = `https://api.getaddress.io/get/${encodeURIComponent(id)}?api-key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url);

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as GetAddressFullAddress;
        return data;
      } catch {
        return null;
      }
    },
  };
};

// Maps a getAddress.io full address response to our StructuredAddress format.
// Omits empty line2, line3, and county fields. Omits coordinates when they are
// zero (getAddress.io returns 0,0 when coordinates are unavailable).
export const addressToStructuredAddress = (
  address: GetAddressFullAddress,
): StructuredAddress => {
  const parts: string[] = [];

  if (address.line_1) parts.push(address.line_1);
  if (address.line_2) parts.push(address.line_2);
  if (address.line_3) parts.push(address.line_3);
  if (address.town_or_city) parts.push(address.town_or_city);
  if (address.county) parts.push(address.county);
  if (address.postcode) parts.push(address.postcode);

  const formatted = parts.join(", ");
  const postcode = address.postcode ? normalizeUkPostcode(address.postcode) : undefined;

  const result: StructuredAddress = { formatted };

  if (address.line_1) result.line1 = address.line_1;
  if (address.line_2) result.line2 = address.line_2;
  if (address.town_or_city) result.town = address.town_or_city;
  if (address.county) result.county = address.county;
  if (postcode) result.postcode = postcode;

  // Only include coordinates if they're non-zero (getAddress.io returns 0,0 when unavailable)
  if (address.latitude !== 0 && address.longitude !== 0) {
    result.lat = address.latitude;
    result.lng = address.longitude;
  }

  return result;
};
