import type { StructuredAddress } from "@/lib/schemas/address";

// Minimal typings for just the slice of the Google Maps JS "places" library
// we use (the new Places API: AutocompleteSuggestion + Place). We avoid the
// heavyweight @types/google.maps dependency and type only our surface.

type PlaceAddressComponent = {
  longText: string | null;
  shortText: string | null;
  types: string[];
};

export type PlaceResult = {
  id: string | null;
  formattedAddress: string | null;
  addressComponents: PlaceAddressComponent[] | null;
  location: { lat: () => number; lng: () => number } | null;
  fetchFields: (options: { fields: string[] }) => Promise<unknown>;
};

export type PlacePrediction = {
  placeId: string;
  text: { toString: () => string };
  toPlace: () => PlaceResult;
};

export type AutocompleteSuggestion = {
  placePrediction: PlacePrediction | null;
};

type PlacesLibrary = {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      includedRegionCodes?: string[];
      sessionToken?: object;
    }) => Promise<{ suggestions: AutocompleteSuggestion[] }>;
  };
  AutocompleteSessionToken: new () => object;
};

type GoogleMaps = { importLibrary: (name: string) => Promise<unknown> };

declare global {
  interface Window {
    google?: { maps?: GoogleMaps };
  }
}

let loaderPromise: Promise<GoogleMaps | null> | null = null;

// Injects the Google Maps JS API (places library) exactly once and resolves
// with the maps namespace — or null if there's no API key or the script fails
// to load. Every caller of Places goes through this, so a missing key or a
// blocked network request degrades gracefully to a plain text field rather
// than throwing.
const loadMaps = (): Promise<GoogleMaps | null> => {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google?.maps) return Promise.resolve(window.google.maps);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.resolve(null);

  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&loading=async&v=weekly`;
    script.async = true;
    script.onload = () => resolve(window.google?.maps ?? null);
    script.onerror = () => {
      loaderPromise = null; // allow a later retry
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
};

// Resolves the Places library, or null when Places is unavailable.
export const loadPlacesLibrary = async (): Promise<PlacesLibrary | null> => {
  const maps = await loadMaps();
  if (!maps) return null;
  try {
    return (await maps.importLibrary("places")) as PlacesLibrary;
  } catch {
    return null;
  }
};

export const createSessionToken = (places: PlacesLibrary): object =>
  new places.AutocompleteSessionToken();

const componentOf = (
  components: PlaceAddressComponent[],
  type: string,
): string | undefined =>
  components.find((c) => c.types.includes(type))?.longText ?? undefined;

// Turns a resolved Place into our StructuredAddress. UK-oriented mapping:
// postal_town is the town/city for most GB addresses, with locality as a
// fallback; administrative_area_level_2 is the county. line1 is built from
// building + street; line2 carries any sub-locality/neighbourhood.
export const placeToStructuredAddress = (place: PlaceResult): StructuredAddress => {
  const components = place.addressComponents ?? [];
  const formatted = place.formattedAddress ?? "";

  const streetNumber = componentOf(components, "street_number");
  const route = componentOf(components, "route");
  const premise = componentOf(components, "premise");
  const subpremise = componentOf(components, "subpremise");

  const street = [streetNumber, route].filter(Boolean).join(" ");
  const line1 =
    [subpremise, premise, street].filter(Boolean).join(", ") || undefined;
  const line2 =
    componentOf(components, "sublocality") ??
    componentOf(components, "neighborhood");
  const town =
    componentOf(components, "postal_town") ?? componentOf(components, "locality");
  const county = componentOf(components, "administrative_area_level_2");
  const postcode = componentOf(components, "postal_code");

  const address: StructuredAddress = { formatted };
  if (line1) address.line1 = line1;
  if (line2) address.line2 = line2;
  if (town) address.town = town;
  if (county) address.county = county;
  if (postcode) address.postcode = postcode;
  if (place.location) {
    address.lat = place.location.lat();
    address.lng = place.location.lng();
  }
  if (place.id) address.place_id = place.id;

  return address;
};
