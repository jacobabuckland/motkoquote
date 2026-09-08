import type { StructuredAddress } from "@/lib/schemas/address";
import { normalizeUkPostcode } from "@/lib/normalize-postcode";

// This module has been superseded by getaddress.ts for production use in
// AddressAutocomplete. It remains for compatibility with existing test 106,
// which tests postcode normalization behavior.

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

const componentOf = (
  components: PlaceAddressComponent[],
  type: string,
): string | undefined =>
  components.find((c) => c.types.includes(type))?.longText ?? undefined;

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
  const rawPostcode = componentOf(components, "postal_code");
  const postcode = rawPostcode ? normalizeUkPostcode(rawPostcode) : undefined;

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
